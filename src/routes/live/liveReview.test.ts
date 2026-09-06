import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { _pathFromToken } from './[token]/+page.server';

const cli = fileURLToPath(new URL('../../../bin/review.js', import.meta.url));
const fixture = fileURLToPath(new URL('../../../README.md', import.meta.url));

describe('standalone live review URL', () => {
	it('round-trips the original path and rejects a modified token', () => {
		const secret = 'test-secret';
		const url = execFileSync(cli, [fixture], {
			env: { ...process.env, ONLINE_REVIEW_URL_SECRET: secret },
			encoding: 'utf8'
		}).trim();
		const token = url.split('/').at(-1)!;
		expect(_pathFromToken(token, secret)).toBe(realpathSync(fixture));
		expect(() => _pathFromToken(`${token}x`, secret)).toThrow();
	});
});
