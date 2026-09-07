import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export class WordConversionError extends Error {
	constructor(public status: 422 | 503 | 504, message: string) {
		super(message);
	}
}

/** Convert a private copy, leaving the reviewed file untouched. */
export async function convertLegacyWord(source: Uint8Array): Promise<Buffer<ArrayBuffer>> {
	const root = path.join(homedir(), '.cache', 'reviewloop', 'word-conversions');
	await mkdir(root, { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(path.join(root, 'doc-'));
	try {
		const input = path.join(directory, 'source.doc');
		await writeFile(input, source);
		try {
			await run(process.env.REVIEW_PLATFORM_LIBREOFFICE_BIN || 'libreoffice', [
				`-env:UserInstallation=${pathToFileURL(path.join(directory, 'profile')).href}`,
				'--headless', '--nologo', '--nodefault', '--norestore',
				'--convert-to', 'docx:Office Open XML Text', '--outdir', directory, input
			], { timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
		} catch (cause) {
			const failure = cause as NodeJS.ErrnoException & { killed?: boolean };
			if (failure.code === 'ENOENT') {
				throw new WordConversionError(503, 'Legacy .doc preview requires LibreOffice on the server. Install LibreOffice Writer or configure REVIEW_PLATFORM_LIBREOFFICE_BIN.');
			}
			if (failure.killed) throw new WordConversionError(504, 'Word document conversion timed out.');
			throw new WordConversionError(422, 'Unable to convert this .doc document. Check that it is a valid, unencrypted Word file.');
		}
		// LibreOffice can exit successfully without producing a file on invalid input.
		const output = path.join(directory, 'source.docx');
		try {
			const info = await stat(output);
			if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) throw new Error('Invalid output size');
			const bytes = await readFile(output);
			if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid output format');
			return bytes;
		} catch {
			throw new WordConversionError(422, 'Unable to produce a valid .docx preview from this Word document.');
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
