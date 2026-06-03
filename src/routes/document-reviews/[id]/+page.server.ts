import { error } from '@sveltejs/kit';
import { getDocumentReviewDetail, ReviewArtifactReadError } from '$lib/server/storage/queries';
import { getReviewStore } from '$lib/server/storage/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	let detail;
	try {
		detail = getDocumentReviewDetail(params.id);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (!detail || !detail.latestVersion) throw error(404, 'Document review not found');
	const comments = getReviewStore().listComments(params.id);
	return { ...detail, comments };
};
