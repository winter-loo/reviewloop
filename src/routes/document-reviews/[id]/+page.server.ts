import { randomUUID } from 'node:crypto';
import { error, fail, redirect } from '@sveltejs/kit';
import { getDocumentReviewDetail, ReviewArtifactReadError } from '$lib/server/storage/queries';
import { renderMarkdownDocument } from '$lib/server/markdown/render';
import { getReviewStore } from '$lib/server/storage/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
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
	const renderedBlocks = renderMarkdownDocument(detail.markdown);
	const requestedLine = Number(url.searchParams.get('commentLine'));
	const activeLine = Number.isInteger(requestedLine) && requestedLine > 0 ? requestedLine : null;
	return { ...detail, renderedBlocks, comments, activeLine, formError: null };
};

export const actions: Actions = {
	addComment: async ({ params, request }) => {
		const store = getReviewStore();
		const review = store.getReview(params.id);
		if (!review) throw error(404, 'Review not found');
		const latestVersion = store.getLatestVersion(params.id);
		if (!latestVersion) throw error(400, 'Review has no version');

		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const filePath = String(form.get('filePath') ?? '').trim();
		const side = String(form.get('side') ?? 'new');
		const lineStart = Number(form.get('lineStart'));
		const lineEnd = form.get('lineEnd') === null ? lineStart : Number(form.get('lineEnd'));
		const author = String(form.get('author') ?? 'reviewer').trim() || 'reviewer';

		if (!body) return fail(400, { activeLine: lineStart, formError: 'Comment body is required.' });
		if (!filePath) return fail(400, { activeLine: lineStart, formError: 'filePath is required for inline review comments.' });
		if (side !== 'old' && side !== 'new') return fail(400, { activeLine: lineStart, formError: 'side must be old or new for inline review comments.' });
		if (!Number.isInteger(lineStart) || lineStart < 1) return fail(400, { activeLine: null, formError: 'lineStart must be a positive integer.' });
		if (!Number.isInteger(lineEnd) || lineEnd < lineStart) return fail(400, { activeLine: lineStart, formError: 'lineEnd must be greater than or equal to lineStart.' });

		const now = new Date().toISOString();
		store.addComment({
			id: randomUUID(),
			reviewId: params.id,
			version: latestVersion.version,
			filePath,
			side,
			lineStart,
			lineEnd,
			body,
			author,
			status: 'open',
			createdAt: now,
			updatedAt: now
		});

		throw redirect(303, `/document-reviews/${params.id}#L${lineStart}`);
	}
};
