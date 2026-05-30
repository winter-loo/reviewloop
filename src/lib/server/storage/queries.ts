import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDiffFileSections, parseDiffFileStats } from '../git/diffStats';
import { getReviewStore } from './store';

const LARGE_PATCH_BYTES = 1024 * 1024;

export class ReviewArtifactReadError extends Error {
	constructor(
		message: string,
		public readonly cause: unknown
	) {
		super(message);
		this.name = 'ReviewArtifactReadError';
	}
}

function readTextArtifact(filePath: string, artifactKind: string) {
	try {
		return readFileSync(filePath, 'utf8');
	} catch (cause) {
		throw new ReviewArtifactReadError(`Unable to read ${artifactKind} artifact`, cause);
	}
}

function readFilesArtifact(filePath: string) {
	const raw = readTextArtifact(filePath, 'files');
	try {
		return JSON.parse(raw);
	} catch (cause) {
		throw new ReviewArtifactReadError('Unable to parse files artifact', cause);
	}
}

function readCommitsArtifact(filesPath: string) {
	const commitsPath = path.join(path.dirname(filesPath), 'commits.json');
	if (!existsSync(commitsPath)) return [];
	const raw = readTextArtifact(commitsPath, 'commits');
	try {
		return JSON.parse(raw);
	} catch (cause) {
		throw new ReviewArtifactReadError('Unable to parse commits artifact', cause);
	}
}

function normalizeLargeFlag<T extends { patchBytes?: number; tooLarge?: boolean }>(file: T): T {
	// Older review artifacts briefly marked generated-like files as tooLarge even
	// when their per-file patch was tiny. The UI contract is now strict: only
	// patches over 1 MiB are collapsed.
	return { ...file, tooLarge: (file.patchBytes ?? 0) > LARGE_PATCH_BYTES };
}

function normalizeCommitLargeFlags<T extends { files?: Array<{ patchBytes?: number; tooLarge?: boolean }> }>(commit: T): T {
	return { ...commit, files: commit.files?.map(normalizeLargeFlag) ?? [] };
}

export function getReviewDetail(reviewId: string) {
	const store = getReviewStore();
	const review = store.getReview(reviewId);
	if (!review) return null;
	const latestVersion = store.getLatestVersion(reviewId);
	let files = latestVersion ? readFilesArtifact(latestVersion.filesPath).map(normalizeLargeFlag) : [];
	const commits = latestVersion ? readCommitsArtifact(latestVersion.filesPath).map(normalizeCommitLargeFlags) : [];
	// Backward compatibility: old snapshots only stored path/addition metadata.
	// Rebuild lightweight per-file metadata from the raw patch without sending the full diff in SSR data.
	if (latestVersion && files.some((file: { id?: string }) => !file.id)) {
		files = parseDiffFileStats(readTextArtifact(latestVersion.diffPath, 'diff')).map(normalizeLargeFlag);
	}
	return { review, latestVersion, files, commits };
}

export function getReviewDiff(reviewId: string, version: number) {
	const store = getReviewStore();
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion || latestVersion.version !== version) return null;
	return readTextArtifact(latestVersion.diffPath, 'diff');
}

export function getReviewFileDiff(reviewId: string, version: number, fileId: string) {
	const store = getReviewStore();
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion || latestVersion.version !== version) return null;
	const files = readFilesArtifact(latestVersion.filesPath);
	const file = files.find((entry: { id?: string }) => entry.id === fileId);
	if (file?.patchPath) return readTextArtifact(file.patchPath, 'file diff');
	// Backward compatibility for snapshots created before per-file artifacts were written.
	const section = parseDiffFileSections(readTextArtifact(latestVersion.diffPath, 'diff')).find((entry) => entry.id === fileId);
	return section?.patch ?? null;
}
