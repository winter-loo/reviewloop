import { randomUUID } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { getReviewStore } from '$lib/server/storage/store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const store = getReviewStore();
	return json({ comments: store.listComments(params.id) });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const store = getReviewStore();
	const review = store.getReview(params.id);
	if (!review) throw error(404, 'Review not found');
	const latestVersion = store.getLatestVersion(params.id);
	if (!latestVersion) throw error(400, 'Review has no version');
	let body: {
		filePath?: string;
		side?: 'old' | 'new' | 'file';
		lineStart?: number;
		lineEnd?: number;
		body?: string;
		author?: string;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		throw error(400, 'Invalid JSON request body');
	}
	if (!body.body?.trim()) throw error(400, 'Comment body is required');
	if (!body.filePath?.trim()) throw error(400, 'filePath is required for inline review comments');
	if (body.side !== 'old' && body.side !== 'new') throw error(400, 'side must be old or new for inline review comments');
	const lineStart = Number(body.lineStart);
	if (!Number.isInteger(lineStart) || lineStart < 1) {
		throw error(400, 'lineStart must be a positive integer for inline review comments');
	}
	const lineEnd = body.lineEnd === undefined ? lineStart : Number(body.lineEnd);
	if (!Number.isInteger(lineEnd) || lineEnd < lineStart) {
		throw error(400, 'lineEnd must be an integer greater than or equal to lineStart');
	}
	const now = new Date().toISOString();
	const comment = {
		id: randomUUID(),
		reviewId: params.id,
		version: latestVersion.version,
		filePath: body.filePath.trim(),
		side: body.side,
		lineStart,
		lineEnd,
		body: body.body.trim(),
		author: body.author ?? 'anonymous',
		status: 'open' as const,
		createdAt: now,
		updatedAt: now
	};
	store.addComment(comment);
	return json({ comment }, { status: 201 });
};
