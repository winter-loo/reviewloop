import { error } from '@sveltejs/kit';
import { getReviewDetail, getReviewDiff, ReviewArtifactReadError } from '$lib/server/storage/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	let detail;
	try {
		detail = getReviewDetail(params.id);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) throw error(500, cause.message);
		throw cause;
	}
	if (!detail?.latestVersion) throw error(404, 'Review not found');

	let diff;
	try {
		diff = getReviewDiff(params.id, detail.latestVersion.version);
	} catch (cause) {
		if (cause instanceof ReviewArtifactReadError) throw error(500, cause.message);
		throw cause;
	}
	if (diff === null) throw error(404, 'Diff not found');

	return new Response(diff, {
		headers: {
			'content-type': 'text/x-diff; charset=utf-8',
			'content-disposition': `attachment; filename="${params.id}.patch"`
		}
	});
};
