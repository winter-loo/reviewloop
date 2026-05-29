import { error } from '@sveltejs/kit';
import { getReviewDetail, getReviewDiff, ReviewArtifactReadError } from '$lib/server/storage/queries';
import { getReviewStore } from '$lib/server/storage/store';

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
	let diff;
	try {
		diff = getReviewDiff(params.id, detail.latestVersion.version) ?? '';
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	const comments = getReviewStore().listComments(params.id);
	return { ...detail, diff, comments };
}
