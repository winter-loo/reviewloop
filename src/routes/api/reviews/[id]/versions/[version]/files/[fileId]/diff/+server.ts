import { error, json } from '@sveltejs/kit';
import { getReviewFileDiff, ReviewArtifactReadError } from '$lib/server/storage/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const version = Number(params.version);
	if (!Number.isInteger(version) || version < 1) throw error(400, 'Invalid review version');
	let diff;
	try {
		diff = getReviewFileDiff(params.id, version, params.fileId);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) {
			throw error(500, cause.message);
		}
		throw cause;
	}
	if (diff === null) throw error(404, 'File diff not found');
	return json({ diff });
};
