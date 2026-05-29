import os from 'node:os';
import path from 'node:path';

/** Root directory for durable review DB and artifact snapshots. Works in both SvelteKit and CLI contexts. */
export function reviewHome() {
	return process.env.LTSQL_REVIEW_HOME || path.join(os.homedir(), '.ltsql-review');
}

/** Directory containing immutable per-review/version artifacts. */
export function artifactsDir() {
	return path.join(reviewHome(), 'artifacts');
}

/** SQLite DB path planned for durable review metadata and comments. */
export function dbPath() {
	return path.join(reviewHome(), 'reviews.db');
}

export function reviewArtifactDir(reviewId: string, version: number) {
	return path.join(artifactsDir(), reviewId, `v${version}`);
}
