import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { artifactsDir, reviewArtifactDir } from '../storage/paths';
import type { ReviewRecord, ReviewSourceKind, ReviewVersionRecord } from '../storage/types';
import type { ReviewStore } from '../storage/db';
import { captureRangeDiff, captureShowDiff, captureStagedDiff, captureWorktreeDiff, getHeadCommit } from '../git/git';
import { parseDiffFileStats, type DiffFileStat } from '../git/diffStats';

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
	url: string;
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

export async function publishReview(input: PublishReviewInput): Promise<PublishReviewResult> {
	const now = timestamp();
	const id = reviewIdFromDate();
	const headCommit = await getHeadCommit(input.repoRoot).catch(() => null);
	const diff = await captureDiff(input);
	const files = parseDiffFileStats(diff);
	const artifactDir = reviewArtifactDir(id, 1).replace(artifactsDir(), path.join(input.store.home, 'artifacts'));
	mkdirSync(artifactDir, { recursive: true });

	const diffPath = path.join(artifactDir, 'diff.patch');
	const filesPath = path.join(artifactDir, 'files.json');
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
	writeFileSync(metadataPath, JSON.stringify({ review, version }, null, 2), 'utf8');
	input.store.insertReview(review);
	input.store.insertVersion(version);

	const baseUrl = input.baseUrl ?? 'http://localhost:5173';
	return { review, version, diff, files, url: `${baseUrl}/reviews/${id}` };
}
