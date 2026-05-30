import { error } from '@sveltejs/kit';
import { getReviewDetail, ReviewArtifactReadError } from '$lib/server/storage/queries';
import { getReviewStore } from '$lib/server/storage/store';
import type { DiffFileStat } from '$lib/server/git/diffStats';

const LARGE_PATCH_BYTES = 1024 * 1024;

type ReviewSummary = {
	additions: number;
	deletions: number;
	patchBytes: number;
	lineCount: number;
	largeFiles: number;
	generatedFiles: number;
};

export function load({ params }) {
	let detail;
	try {
		detail = getReviewDetail(params.id);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (!detail || !detail.latestVersion) throw error(404, 'Review not found');
	const comments = getReviewStore().listComments(params.id);
	const summary = (detail.files as DiffFileStat[]).reduce(
		(acc: ReviewSummary, file: DiffFileStat) => {
			acc.additions += file.additions ?? 0;
			acc.deletions += file.deletions ?? 0;
			acc.patchBytes += file.patchBytes ?? 0;
			acc.lineCount += file.lineCount ?? 0;
			if ((file.patchBytes ?? 0) > LARGE_PATCH_BYTES) acc.largeFiles += 1;
			if (file.generatedLike) acc.generatedFiles += 1;
			return acc;
		},
		{ additions: 0, deletions: 0, patchBytes: 0, lineCount: 0, largeFiles: 0, generatedFiles: 0 }
	);
	return { ...detail, comments, summary };
}
