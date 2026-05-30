import { spawn } from 'node:child_process';

export interface GitCommandResult {
	stdout: string;
	stderr: string;
}

export interface GitCommitSummary {
	sha: string;
	shortSha: string;
	authorName: string;
	authorEmail: string;
	authorDate: string;
	subject: string;
	message: string;
}

const MAX_BUFFER_BYTES = 50 * 1024 * 1024;

/**
 * Run a Git command with an explicit argument array. Never pass user input through a shell.
 */
function runGit(repoRoot: string, args: string[]): Promise<GitCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', ['-C', repoRoot, ...args], {
			stdio: ['ignore', 'pipe', 'pipe']
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;

		child.stdout.on('data', (chunk: Buffer) => {
			stdoutBytes += chunk.length;
			if (stdoutBytes > MAX_BUFFER_BYTES) {
				child.kill('SIGTERM');
				reject(new Error('Git stdout exceeded safety limit'));
				return;
			}
			stdoutChunks.push(chunk);
		});

		child.stderr.on('data', (chunk: Buffer) => {
			stderrBytes += chunk.length;
			if (stderrBytes <= MAX_BUFFER_BYTES) {
				stderrChunks.push(chunk);
			}
		});

		child.on('error', reject);
		child.on('close', (code) => {
			const stdout = Buffer.concat(stdoutChunks).toString('utf8');
			const stderr = Buffer.concat(stderrChunks).toString('utf8');
			if (code !== 0) {
				reject(new Error(`git ${args.join(' ')} failed with code ${code}: ${stderr}`));
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

export async function getGitRoot(cwd: string) {
	const result = await runGit(cwd, ['rev-parse', '--show-toplevel']);
	return result.stdout.trim();
}

export async function getHeadCommit(repoRoot: string) {
	const result = await runGit(repoRoot, ['rev-parse', 'HEAD']);
	return result.stdout.trim();
}

export async function captureWorktreeDiff(repoRoot: string) {
	const result = await runGit(repoRoot, ['diff', '--no-ext-diff', '--find-renames', '--no-color']);
	return result.stdout;
}

export async function captureStagedDiff(repoRoot: string) {
	const result = await runGit(repoRoot, [
		'diff',
		'--staged',
		'--no-ext-diff',
		'--find-renames',
		'--no-color'
	]);
	return result.stdout;
}

export async function captureRangeDiff(repoRoot: string, range: string) {
	// The range is intentionally passed as one argv item so HEAD~4...HEAD keeps Git semantics.
	const result = await runGit(repoRoot, [
		'diff',
		'--no-ext-diff',
		'--find-renames',
		'--no-color',
		range
	]);
	return result.stdout;
}

export async function listRangeCommits(repoRoot: string, range: string): Promise<GitCommitSummary[]> {
	const result = await runGit(repoRoot, ['log', '--reverse', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B%x1e', range]);
	return parseCommitLog(result.stdout);
}

export async function getCommitSummary(repoRoot: string, ref: string): Promise<GitCommitSummary | null> {
	const result = await runGit(repoRoot, ['log', '-1', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%B%x1e', ref]);
	return parseCommitLog(result.stdout)[0] ?? null;
}

function parseCommitLog(stdout: string): GitCommitSummary[] {
	return stdout
		.split('\x1e')
		.map((record) => record.trim())
		.filter(Boolean)
		.map((record) => {
			const [sha, shortSha, authorName, authorEmail, authorDate, subject, ...messageParts] = record.split('\x1f');
			const message = messageParts.join('\x1f').trim() || subject;
			return { sha, shortSha, authorName, authorEmail, authorDate, subject, message };
		});
}

export async function captureCommitDiff(repoRoot: string, sha: string) {
	const result = await runGit(repoRoot, ['show', '--format=', '--no-ext-diff', '--find-renames', '--no-color', sha]);
	return result.stdout;
}

export async function captureShowDiff(repoRoot: string, ref: string) {
	const result = await runGit(repoRoot, [
		'show',
		'--format=',
		'--no-ext-diff',
		'--find-renames',
		'--no-color',
		ref
	]);
	return result.stdout;
}
