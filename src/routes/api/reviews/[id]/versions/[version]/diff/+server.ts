import { error, json } from '@sveltejs/kit';
import { getReviewDiff, ReviewArtifactReadError } from '$lib/server/storage/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	let diff;
	try {
		diff = getReviewDiff(params.id, Number(params.version));
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (diff === null) throw error(404, 'Diff not found');
	return json({ diff });
};
