export interface DiffFileStat {
	path: string;
	additions: number;
	deletions: number;
	status: 'added' | 'deleted' | 'modified' | 'renamed';
}

function parsePathFromDiffGit(line: string) {
	const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
	if (!match) return null;
	return { oldPath: match[1], newPath: match[2] };
}

/** Parse enough unified-diff metadata for MVP file lists and stats. */
export function parseDiffFileStats(diff: string): DiffFileStat[] {
	const files: DiffFileStat[] = [];
	let current: DiffFileStat | null = null;

	for (const line of diff.split('\n')) {
		const header = parsePathFromDiffGit(line);
		if (header) {
			current = {
				path: header.newPath,
				additions: 0,
				deletions: 0,
				status: 'modified'
			};
			files.push(current);
			continue;
		}

		if (!current) continue;
		if (line.startsWith('new file mode')) current.status = 'added';
		if (line.startsWith('deleted file mode')) current.status = 'deleted';
		if (line.startsWith('rename to ')) {
			current.status = 'renamed';
			current.path = line.slice('rename to '.length);
		}
		if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
		if (line.startsWith('+')) current.additions += 1;
		if (line.startsWith('-')) current.deletions += 1;
	}

	return files;
}
