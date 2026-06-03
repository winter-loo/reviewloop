import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { artifactsDir, reviewArtifactDir } from '../storage/paths';
import type { ReviewRecord, ReviewSourceKind, ReviewVersionRecord } from '../storage/types';
import type { ReviewStore } from '../storage/db';
import { captureCommitDiff, captureRangeDiff, captureShowDiff, captureStagedDiff, captureWorktreeDiff, getCommitSummary, getHeadCommit, listRangeCommits, type GitCommitSummary } from '../git/git';
import { parseDiffFileSections, type DiffFileStat } from '../git/diffStats';

export interface PublishReviewInput {
	repoRoot: string;
	title: string;
	sourceKind: ReviewSourceKind;
	sourceRef?: string | null;
	createdBy: string;
	store: ReviewStore;
	baseUrl?: string;
}

export interface PublishReviewResult {
	review: ReviewRecord;
	version: ReviewVersionRecord;
	diff: string;
	files: DiffFileStat[];
	commits: ReviewCommitSection[];
	url: string;
}

export interface ReviewCommitSection extends GitCommitSummary {
	id: string;
	files: DiffFileStat[];
	diffPath?: string;
	patchBytes: number;
	lineCount: number;
	additions: number;
	deletions: number;
}

function timestamp() {
	return new Date().toISOString();
}

function reviewIdFromDate(now = new Date()) {
	const date = now.toISOString().slice(0, 10).replaceAll('-', '');
	const suffix = `${now.getHours()}${now.getMinutes()}${now.getSeconds()}${now.getMilliseconds()}`
		.padStart(9, '0')
		.slice(-4);
	return `CR-${date}-${suffix}`;
}

async function captureDiff(input: PublishReviewInput) {
	if (input.sourceKind === 'worktree') return captureWorktreeDiff(input.repoRoot);
	if (input.sourceKind === 'staged') return captureStagedDiff(input.repoRoot);
	if (input.sourceKind === 'range') {
		if (!input.sourceRef) throw new Error('sourceRef is required for range reviews');
		return captureRangeDiff(input.repoRoot, input.sourceRef);
	}
	if (input.sourceKind === 'show') {
		if (!input.sourceRef) throw new Error('sourceRef is required for show reviews');
		return captureShowDiff(input.repoRoot, input.sourceRef);
	}
	throw new Error(`Unsupported source kind: ${input.sourceKind}`);
}

function commitId(index: number) {
	return `c${String(index + 1).padStart(6, '0')}`;
}

function prefixFileId(commit: string, fileId?: string) {
	return `${commit}-f${fileId ?? '000000'}`;
}

function summarizeFiles(files: DiffFileStat[]) {
	return files.reduce(
		(summary, file) => {
			summary.patchBytes += file.patchBytes ?? 0;
			summary.lineCount += file.lineCount ?? 0;
			summary.additions += file.additions ?? 0;
			summary.deletions += file.deletions ?? 0;
			return summary;
		},
		{ patchBytes: 0, lineCount: 0, additions: 0, deletions: 0 }
	);
}

async function captureCommitSections(input: PublishReviewInput): Promise<Array<GitCommitSummary & { diff: string }>> {
	if (input.sourceKind === 'range' && input.sourceRef) {
		const commits = await listRangeCommits(input.repoRoot, input.sourceRef);
		return Promise.all(commits.map(async (commit) => ({ ...commit, diff: await captureCommitDiff(input.repoRoot, commit.sha) })));
	}
	if (input.sourceKind === 'show' && input.sourceRef) {
		const commit = await getCommitSummary(input.repoRoot, input.sourceRef);
		if (commit) return [{ ...commit, diff: await captureShowDiff(input.repoRoot, input.sourceRef) }];
	}
	return [];
}

export interface PublishDocumentReviewInput {
	title: string;
	filePath: string;
	createdBy: string;
	store: ReviewStore;
	baseUrl?: string;
}

export interface PublishDocumentReviewResult {
	review: ReviewRecord;
	version: ReviewVersionRecord;
	document: { path: string; artifactPath: string; lineCount: number };
	url: string;
}

export function publishDocumentReview(input: PublishDocumentReviewInput): PublishDocumentReviewResult {
	const now = timestamp();
	const id = reviewIdFromDate();
	const sourcePath = path.resolve(input.filePath);
	const markdown = readFileSync(sourcePath, 'utf8');
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	mkdirSync(artifactDir, { recursive: true });

	const markdownPath = path.join(artifactDir, 'document.md');
	const filesPath = path.join(artifactDir, 'document.json');
	const metadataPath = path.join(artifactDir, 'metadata.json');
	const review: ReviewRecord = {
		id,
		title: input.title,
		repoRoot: path.dirname(sourcePath),
		sourceKind: 'document',
		sourceRef: sourcePath,
		status: 'in_review',
		createdBy: input.createdBy,
		createdAt: now,
		updatedAt: now
	};
	const version: ReviewVersionRecord = {
		id: `${id}-v1`,
		reviewId: id,
		version: 1,
		baseCommit: null,
		headCommit: null,
		diffPath: markdownPath,
		filesPath,
		createdAt: now
	};
	const lineCount = markdown.split('\n').length;
	const document = { path: sourcePath, artifactPath: markdownPath, lineCount };
	writeFileSync(markdownPath, markdown, 'utf8');
	writeFileSync(filesPath, JSON.stringify({ document }, null, 2), 'utf8');
	writeFileSync(metadataPath, JSON.stringify({ review, version, document }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);
	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, document, url: `${baseUrl}/document-reviews/${id}` };
}

export async function publishReview(input: PublishReviewInput): Promise<PublishReviewResult> {
	const now = timestamp();
	const id = reviewIdFromDate();
	const headCommit = await getHeadCommit(input.repoRoot).catch(() => null);
	const diff = await captureDiff(input);
	const commitDiffs = await captureCommitSections(input);
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	const fileArtifactsDir = path.join(artifactDir, 'files');
	const commitArtifactsDir = path.join(artifactDir, 'commits');
	mkdirSync(fileArtifactsDir, { recursive: true });
	mkdirSync(commitArtifactsDir, { recursive: true });

	const diffPath = path.join(artifactDir, 'diff.patch');
	let files: DiffFileStat[] = [];
	const commits: ReviewCommitSection[] = commitDiffs.map(({ diff: commitDiff, ...commit }, index) => {
		const id = commitId(index);
		const diffPath = path.join(commitArtifactsDir, `${id}.patch`);
		const commitFiles = parseDiffFileSections(commitDiff).map(({ patch, ...file }) => {
			const fileId = prefixFileId(id, file.id);
			const patchPath = path.join(fileArtifactsDir, `${fileId}.patch`);
			writeFileSync(patchPath, patch, 'utf8');
			return { ...file, id: fileId, patchPath } satisfies DiffFileStat;
		});
		writeFileSync(diffPath, commitDiff, 'utf8');
		files = [...files, ...commitFiles];
		return { ...commit, id, files: commitFiles, diffPath, ...summarizeFiles(commitFiles) };
	});

	if (files.length === 0) {
		files = parseDiffFileSections(diff).map(({ patch, ...file }) => {
			const patchPath = path.join(fileArtifactsDir, `${file.id}.patch`);
			writeFileSync(patchPath, patch, 'utf8');
			return { ...file, patchPath } satisfies DiffFileStat;
		});
	}
	const filesPath = path.join(artifactDir, 'files.json');
	const commitsPath = path.join(artifactDir, 'commits.json');
	const metadataPath = path.join(artifactDir, 'metadata.json');

	const review: ReviewRecord = {
		id,
		title: input.title,
		repoRoot: input.repoRoot,
		sourceKind: input.sourceKind,
		sourceRef: input.sourceRef ?? null,
		status: 'in_review',
		createdBy: input.createdBy,
		createdAt: now,
		updatedAt: now
	};

	const version: ReviewVersionRecord = {
		id: `${id}-v1`,
		reviewId: id,
		version: 1,
		baseCommit: null,
		headCommit,
		diffPath,
		filesPath,
		createdAt: now
	};

	writeFileSync(diffPath, diff, 'utf8');
	writeFileSync(filesPath, JSON.stringify(files, null, 2), 'utf8');
	writeFileSync(commitsPath, JSON.stringify(commits, null, 2), 'utf8');
	writeFileSync(metadataPath, JSON.stringify({ review, version, commitsPath }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);

	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, diff, files, commits, url: `${baseUrl}/reviews/${id}` };
}
