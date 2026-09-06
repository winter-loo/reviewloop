import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { _pathsFromToken, _isWordFile } from '../+page.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const secret = process.env.ONLINE_REVIEW_URL_SECRET;
	if (!secret) throw error(503, 'Live review is not configured');

	let filePaths: string[];
	try {
		filePaths = _pathsFromToken(params.token, secret);
	} catch {
		throw error(404, 'Review not found');
	}

	if (filePaths.length !== 1) {
		throw error(400, 'Invalid Word review');
	}

	const targetPath = filePaths[0];
	let resolved: string;
	try {
		resolved = realpathSync(targetPath);
	} catch {
		throw error(404, 'File not found');
	}

	const home = realpathSync(process.env.HOME || homedir());
	if (!(resolved.startsWith(`${home}${path.sep}`) || resolved.startsWith(`/tmp${path.sep}`))) {
		throw error(403, 'File is not publishable');
	}

	if (!_isWordFile(resolved)) {
		throw error(415, 'Not a Word document');
	}

	const stats = statSync(resolved);
	if (!stats.isFile()) throw error(404, 'File not found');
	if (stats.size > 50 * 1024 * 1024) throw error(413, 'Word document exceeds 50 MiB');

	const isDocx = path.extname(resolved).toLowerCase() === '.docx';
	const contentType = isDocx
		? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
		: 'application/msword';

	return new Response(readFileSync(resolved), {
		headers: {
			'content-type': contentType,
			'cache-control': 'private, max-age=3600',
			'x-content-type-options': 'nosniff'
		}
	});
};
