import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createReviewStore } from '../storage/db';
import { publishReview } from './publish';

function createGitRepo() {
	const repo = mkdtempSync(path.join(os.tmpdir(), 'ltsql-review-repo-'));
	execFileSync('git', ['init'], { cwd: repo });
	execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
	writeFileSync(path.join(repo, 'a.txt'), 'one\n');
	execFileSync('git', ['add', 'a.txt'], { cwd: repo });
	execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });
	writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
	return repo;
}

describe('publishReview', () => {
	it('creates a durable worktree review snapshot without mutating the repo', async () => {
		const repo = createGitRepo();
		const home = mkdtempSync(path.join(os.tmpdir(), 'ltsql-review-home-'));
		mkdirSync(home, { recursive: true });
		const store = createReviewStore(home);
		const beforeStatus = execFileSync('git', ['status', '--short'], { cwd: repo }).toString();

		const result = await publishReview({
			repoRoot: repo,
			title: 'local worktree smoke',
			sourceKind: 'worktree',
			createdBy: 'tester',
			store,
			baseUrl: 'http://localhost:5173'
		});

		expect(result.review.id).toMatch(/^CR-\d{8}-\d{4}$/);
		expect(result.version.version).toBe(1);
		expect(result.url).toContain(`/reviews/${result.review.id}`);
		expect(result.diff).toContain('+two');
		expect(result.files).toEqual([
			expect.objectContaining({ path: 'a.txt', additions: 1, deletions: 0, status: 'modified' })
		]);
		const afterStatus = execFileSync('git', ['status', '--short'], { cwd: repo }).toString();
		expect(afterStatus).toBe(beforeStatus);
	});
});
