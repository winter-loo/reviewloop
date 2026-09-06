import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { renderMarkdownDocument } from '$lib/server/markdown/render';
import type { PageServerLoad } from './$types';

export function _pathFromToken(token: string, secret: string) {
	const payload = Buffer.from(token, 'base64url');
	if (payload.length <= 28 || payload.toString('base64url') !== token) throw error(404, 'Review not found');
	const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), payload.subarray(0, 12));
	decipher.setAuthTag(payload.subarray(12, 28));
	return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}

export const load: PageServerLoad = ({ params, setHeaders }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let resolved: string;
	try {
		resolved = realpathSync(_pathFromToken(params.token, secret));
	} catch {
		throw error(404, 'Review not found');
	}

	const home = realpathSync(process.env.HOME || '/home/ldd');
	if (!(resolved.startsWith(`${home}${path.sep}`) || resolved.startsWith(`/tmp${path.sep}`)) || path.extname(resolved).toLowerCase() !== '.md') {
		throw error(403, 'File is not publishable');
	}

	const stats = statSync(resolved);
	if (stats.size > 5 * 1024 * 1024) throw error(413, 'Document exceeds 5 MiB');
	const markdown = readFileSync(resolved, 'utf8');
	setHeaders({ 'cache-control': 'no-store' });
	return {
		filename: path.basename(resolved),
		updatedAt: stats.mtime.toISOString(),
		lineCount: markdown.split('\n').length,
		renderedBlocks: renderMarkdownDocument(markdown)
	};
};