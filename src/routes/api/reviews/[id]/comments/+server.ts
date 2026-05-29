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
	const now = new Date().toISOString();
	const comment = {
		id: randomUUID(),
		reviewId: params.id,
		version: latestVersion.version,
		filePath: body.filePath ?? null,
		side: body.side ?? 'file',
		lineStart: body.lineStart ?? null,
		lineEnd: body.lineEnd ?? body.lineStart ?? null,
		body: body.body.trim(),
		author: body.author ?? 'anonymous',
		status: 'open' as const,
		createdAt: now,
		updatedAt: now
	};
	store.addComment(comment);
	return json({ comment }, { status: 201 });
};
