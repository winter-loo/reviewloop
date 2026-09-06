import { createDecipheriv, createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { resolveToken } from '$lib/server/shortLinks';
import { documentImageMediaType } from '$lib/server/publishers/document';
import { renderMarkdownDocument } from '$lib/server/markdown/render';
import type { PageServerLoad } from './$types';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.avif']);

export function _isImageFile(filePath: string) {
	return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function _isMarkdownFile(filePath: string) {
	return path.extname(filePath).toLowerCase() === '.md';
}

export function _pathFromToken(token: string, secret: string) {
	const resolvedToken = resolveToken(token);
	const payload = Buffer.from(resolvedToken, 'base64url');
	if (payload.length <= 28 || payload.toString('base64url') !== resolvedToken) throw error(404, 'Review not found');
	const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), payload.subarray(0, 12));
	decipher.setAuthTag(payload.subarray(12, 28));
	return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}

export function _pathsFromToken(token: string, secret: string): string[] {
	const raw = _pathFromToken(token, secret);
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
			return parsed;
		}
		if (parsed && Array.isArray(parsed.files) && parsed.files.every((item: unknown) => typeof item === 'string')) {
			return parsed.files;
		}
	} catch {
		// Not JSON, plain string path
	}
	return [raw];
}

export const load: PageServerLoad = ({ params, setHeaders }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _pathsFromToken(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	if (!filePaths.length) throw error(404, 'Review not found');

	const home = realpathSync(process.env.HOME || homedir());
	const resolvedPaths: string[] = [];

	for (const p of filePaths) {
		let resolved: string;
		try {
			resolved = realpathSync(p);
		} catch {
			throw error(404, 'Review not found');
		}
		if (!(resolved.startsWith(`${home}${path.sep}`) || resolved.startsWith(`/tmp${path.sep}`))) {
			throw error(403, 'File is not publishable');
		}
		const stats = statSync(resolved);
		if (!stats.isFile()) {
			throw error(403, 'File is not publishable');
		}
		resolvedPaths.push(resolved);
	}

	const allImages = resolvedPaths.every(_isImageFile);
	const isMarkdown = resolvedPaths.length === 1 && _isMarkdownFile(resolvedPaths[0]);

	if (!allImages && !isMarkdown) {
		throw error(403, 'Only Markdown files or Image files are supported');
	}

	setHeaders({ 'cache-control': 'no-store' });

	if (isMarkdown) {
		const resolved = resolvedPaths[0];
		const stats = statSync(resolved);
		if (stats.size > 5 * 1024 * 1024) throw error(413, 'Document exceeds 5 MiB');
		const markdown = readFileSync(resolved, 'utf8');
		return {
			kind: 'markdown' as const,
			token: params.token,
			filename: path.basename(resolved),
			updatedAt: stats.mtime.toISOString(),
			lineCount: markdown.split('\n').length,
			renderedBlocks: renderMarkdownDocument(markdown)
		};
	}

	// Images mode
	const images = resolvedPaths.map((resolved, index) => {
		const stats = statSync(resolved);
		if (stats.size > 5 * 1024 * 1024) throw error(413, `Image ${path.basename(resolved)} exceeds 5 MiB`);
		return {
			id: `img-${index}`,
			index,
			filename: path.basename(resolved),
			size: stats.size,
			updatedAt: stats.mtime.toISOString(),
			src: `/live/${params.token}/image?index=${index}`,
			mediaType: documentImageMediaType(resolved) ?? 'image/png'
		};
	});

	return {
		kind: 'image' as const,
		token: params.token,
		images
	};
};