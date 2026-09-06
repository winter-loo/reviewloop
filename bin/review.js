#!/usr/bin/env node

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const BASE_URL = 'https://deeloo.cn/live';
const MAX_BYTES = 5 * 1024 * 1024;

function secret() {
	if (process.env.ONLINE_REVIEW_URL_SECRET) return process.env.ONLINE_REVIEW_URL_SECRET;
	const env = readFileSync(path.join(homedir(), '.config/online-review.env'), 'utf8');
	const line = env.split(/\r?\n/).find((value) => value.startsWith('ONLINE_REVIEW_URL_SECRET='));
	if (!line) throw new Error('ONLINE_REVIEW_URL_SECRET is not configured');
	return line.slice(line.indexOf('=') + 1);
}

function latestMarkdown(directory) {
	const candidates = readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
		.map((entry) => path.join(directory, entry.name));
	if (!candidates.length) throw new Error(`No Markdown file in ${directory}`);
	return candidates.reduce((latest, candidate) =>
		statSync(candidate).mtimeMs > statSync(latest).mtimeMs ? candidate : latest
	);
}

function main() {
	const input = process.argv.slice(2).join(' ').trim();
	const file = realpathSync(input ? path.resolve(input) : latestMarkdown(process.cwd()));
	const home = realpathSync(homedir());
	if (!(file.startsWith(`${home}${path.sep}`) || file.startsWith(`/tmp${path.sep}`))) throw new Error('File must be under HOME or /tmp');
	if (path.extname(file).toLowerCase() !== '.md') throw new Error('Only Markdown files are supported');
	const stats = statSync(file);
	if (!stats.isFile() || stats.size > MAX_BYTES) throw new Error('File must be a regular file no larger than 5 MiB');

	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret()).digest(), iv);
	const encrypted = Buffer.concat([cipher.update(file, 'utf8'), cipher.final()]);
	console.log(`${BASE_URL}/${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`);
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
