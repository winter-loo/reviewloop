export interface DiffFileStat {
	id?: string;
	path: string;
	oldPath?: string;
	additions: number;
	deletions: number;
	status: 'added' | 'deleted' | 'modified' | 'renamed';
	patchPath?: string;
	patchBytes?: number;
	lineCount?: number;
	tooLarge?: boolean;
	generatedLike?: boolean;
}

export interface DiffFileSection extends Required<Pick<DiffFileStat, 'id' | 'path' | 'additions' | 'deletions' | 'status' | 'patchBytes' | 'lineCount' | 'tooLarge' | 'generatedLike'>> {
	oldPath?: string;
	patch: string;
}

export interface DiffParseOptions {
	largePatchBytes?: number;
	largeLineCount?: number;
}

const DEFAULT_LARGE_PATCH_BYTES = 1024 * 1024;
const DEFAULT_LARGE_LINE_COUNT = Number.POSITIVE_INFINITY;

function parsePathFromDiffGit(line: string) {
	const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
	if (!match) return null;
	return { oldPath: match[1], newPath: match[2] };
}

function fileId(index: number) {
	return String(index + 1).padStart(6, '0');
}

function looksGeneratedOrNoisy(filePath: string) {
	return /(^|\/)(expected|data_out|comparison_out|generated|dist|build)(\/|$)/.test(filePath)
		|| /\.(out|result|expected|snap|min\.js|lock|patch)$/i.test(filePath)
		|| /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(filePath);
}

function byteLength(text: string) {
	return Buffer.byteLength(text, 'utf8');
}

function parseSection(index: number, lines: string[], options: Required<DiffParseOptions>): DiffFileSection | null {
	if (lines.length === 0) return null;
	const header = parsePathFromDiffGit(lines[0]);
	if (!header) return null;

	let path = header.newPath;
	let oldPath = header.oldPath;
	let additions = 0;
	let deletions = 0;
	let status: DiffFileStat['status'] = 'modified';

	for (const line of lines) {
		if (line.startsWith('new file mode')) status = 'added';
		if (line.startsWith('deleted file mode')) status = 'deleted';
		if (line.startsWith('rename from ')) oldPath = line.slice('rename from '.length);
		if (line.startsWith('rename to ')) {
			status = 'renamed';
			path = line.slice('rename to '.length);
		}
		if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
		if (line.startsWith('+')) additions += 1;
		if (line.startsWith('-')) deletions += 1;
	}

	const patch = lines.join('\n');
	const patchBytes = byteLength(patch);
	const lineCount = lines.length;
	const generatedLike = looksGeneratedOrNoisy(path);
	const tooLarge = patchBytes > options.largePatchBytes || lineCount > options.largeLineCount;

	return {
		id: fileId(index),
		path,
		oldPath: oldPath === path ? undefined : oldPath,
		additions,
		deletions,
		status,
		patch,
		patchBytes,
		lineCount,
		tooLarge,
		generatedLike
	};
}

/** Split a unified diff into per-file patches with metadata for lazy review UIs. */
export function parseDiffFileSections(diff: string, parseOptions: DiffParseOptions = {}): DiffFileSection[] {
	const options = {
		largePatchBytes: parseOptions.largePatchBytes ?? DEFAULT_LARGE_PATCH_BYTES,
		largeLineCount: parseOptions.largeLineCount ?? DEFAULT_LARGE_LINE_COUNT
	};
	const sections: string[][] = [];
	let current: string[] | null = null;

	for (const line of diff.split('\n')) {
		if (parsePathFromDiffGit(line)) {
			if (current) sections.push(current);
			current = [line];
			continue;
		}
		if (current) current.push(line);
	}
	if (current) sections.push(current);

	return sections
		.map((lines, index) => parseSection(index, lines, options))
		.filter((section): section is DiffFileSection => section !== null);
}

/** Parse enough unified-diff metadata for MVP file lists and stats. */
export function parseDiffFileStats(diff: string): DiffFileStat[] {
	return parseDiffFileSections(diff).map(({ patch: _patch, ...file }) => file);
}
