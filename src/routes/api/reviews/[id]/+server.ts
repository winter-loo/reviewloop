import { error, json } from '@sveltejs/kit';
import { getReviewDetail, ReviewArtifactReadError } from '$lib/server/storage/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	let payload;
	try {
		payload = getReviewDetail(params.id);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (!payload) throw error(404, 'Review not found');
	return json(payload);
};
