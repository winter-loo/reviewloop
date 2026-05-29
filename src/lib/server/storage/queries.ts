import { readFileSync } from 'node:fs';
import { getReviewStore } from './store';

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

export function getReviewDetail(reviewId: string) {
	const store = getReviewStore();
	const review = store.getReview(reviewId);
	if (!review) return null;
	const latestVersion = store.getLatestVersion(reviewId);
	const files = latestVersion ? readFilesArtifact(latestVersion.filesPath) : [];
	return { review, latestVersion, files };
}

export function getReviewDiff(reviewId: string, version: number) {
	const store = getReviewStore();
	const latestVersion = store.getLatestVersion(reviewId);
	if (!latestVersion || latestVersion.version !== version) return null;
	return readTextArtifact(latestVersion.diffPath, 'diff');
}
