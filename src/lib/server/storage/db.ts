import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dbPath as defaultDbPath } from './paths';
import { schemaSql } from './schema';
import type { ReviewCommentRecord, ReviewRecord, ReviewVersionRecord } from './types';

function toReview(row: Record<string, unknown>): ReviewRecord {
	return {
		id: String(row.id),
		title: String(row.title),
		repoRoot: String(row.repo_root),
		sourceKind: row.source_kind as ReviewRecord['sourceKind'],
		sourceRef: row.source_ref === null ? null : String(row.source_ref),
		status: row.status as ReviewRecord['status'],
		createdBy: String(row.created_by),
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at)
	};
}

function toVersion(row: Record<string, unknown>): ReviewVersionRecord {
	return {
		id: String(row.id),
		reviewId: String(row.review_id),
		version: Number(row.version),
		baseCommit: row.base_commit === null ? null : String(row.base_commit),
		headCommit: row.head_commit === null ? null : String(row.head_commit),
		diffPath: String(row.diff_path),
		filesPath: String(row.files_path),
		createdAt: String(row.created_at)
	};
}

function toComment(row: Record<string, unknown>): ReviewCommentRecord {
	return {
		id: String(row.id),
		reviewId: String(row.review_id),
		version: Number(row.version),
		filePath: row.file_path === null ? null : String(row.file_path),
		side: row.side as ReviewCommentRecord['side'],
		lineStart: row.line_start === null ? null : Number(row.line_start),
		lineEnd: row.line_end === null ? null : Number(row.line_end),
		body: String(row.body),
		author: String(row.author),
		status: row.status as ReviewCommentRecord['status'],
		createdAt: String(row.created_at),
		updatedAt: String(row.updated_at)
	};
}

function sqlParams(values: Record<string, SQLInputValue>): Record<string, SQLInputValue> {
	return values;
}

export interface ReviewStore {
	home: string;
	db: DatabaseSync;
	insertReview(review: ReviewRecord): void;
	insertVersion(version: ReviewVersionRecord): void;
	listReviews(): ReviewRecord[];
	getReview(id: string): ReviewRecord | null;
	getLatestVersion(reviewId: string): ReviewVersionRecord | null;
	listComments(reviewId: string): ReviewCommentRecord[];
	addComment(comment: ReviewCommentRecord): void;
	close(): void;
}

export function createReviewStore(home?: string): ReviewStore {
	const resolvedHome = home ?? path.dirname(defaultDbPath());
	mkdirSync(resolvedHome, { recursive: true });
	const db = new DatabaseSync(path.join(resolvedHome, 'reviews.db'));
	db.exec('PRAGMA journal_mode = WAL');
	db.exec(schemaSql);

	return {
		home: resolvedHome,
		db,
		insertReview(review) {
			db.prepare(
				`INSERT INTO reviews (id, title, repo_root, source_kind, source_ref, status, created_by, created_at, updated_at)
				 VALUES (@id, @title, @repoRoot, @sourceKind, @sourceRef, @status, @createdBy, @createdAt, @updatedAt)`
			).run(
				sqlParams({
					id: review.id,
					title: review.title,
					repoRoot: review.repoRoot,
					sourceKind: review.sourceKind,
					sourceRef: review.sourceRef,
					status: review.status,
					createdBy: review.createdBy,
					createdAt: review.createdAt,
					updatedAt: review.updatedAt
				})
			);
		},
		insertVersion(version) {
			db.prepare(
				`INSERT INTO review_versions (id, review_id, version, base_commit, head_commit, diff_path, files_path, created_at)
				 VALUES (@id, @reviewId, @version, @baseCommit, @headCommit, @diffPath, @filesPath, @createdAt)`
			).run(
				sqlParams({
					id: version.id,
					reviewId: version.reviewId,
					version: version.version,
					baseCommit: version.baseCommit,
					headCommit: version.headCommit,
					diffPath: version.diffPath,
					filesPath: version.filesPath,
					createdAt: version.createdAt
				})
			);
		},
		listReviews() {
			return db.prepare('SELECT * FROM reviews ORDER BY updated_at DESC').all().map((row) => toReview(row as Record<string, unknown>));
		},
		getReview(id) {
			const row = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
			return row ? toReview(row as Record<string, unknown>) : null;
		},
		getLatestVersion(reviewId) {
			const row = db
				.prepare('SELECT * FROM review_versions WHERE review_id = ? ORDER BY version DESC LIMIT 1')
				.get(reviewId);
			return row ? toVersion(row as Record<string, unknown>) : null;
		},
		listComments(reviewId) {
			return db
				.prepare('SELECT * FROM comments WHERE review_id = ? ORDER BY created_at ASC')
				.all(reviewId)
				.map((row) => toComment(row as Record<string, unknown>));
		},
		addComment(comment) {
			db.prepare(
				`INSERT INTO comments (id, review_id, version, file_path, side, line_start, line_end, body, author, status, created_at, updated_at)
				 VALUES (@id, @reviewId, @version, @filePath, @side, @lineStart, @lineEnd, @body, @author, @status, @createdAt, @updatedAt)`
			).run(
				sqlParams({
					id: comment.id,
					reviewId: comment.reviewId,
					version: comment.version,
					filePath: comment.filePath,
					side: comment.side,
					lineStart: comment.lineStart,
					lineEnd: comment.lineEnd,
					body: comment.body,
					author: comment.author,
					status: comment.status,
					createdAt: comment.createdAt,
					updatedAt: comment.updatedAt
				})
			);
		},
		close() {
			db.close();
		}
	};
}
