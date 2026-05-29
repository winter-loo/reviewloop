export type ReviewStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'superseded' | 'closed';

export type ReviewSourceKind = 'worktree' | 'staged' | 'show' | 'range';

export interface ReviewRecord {
	id: string;
	title: string;
	repoRoot: string;
	sourceKind: ReviewSourceKind;
	sourceRef: string | null;
	status: ReviewStatus;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
}

export interface ReviewVersionRecord {
	id: string;
	reviewId: string;
	version: number;
	baseCommit: string | null;
	headCommit: string | null;
	diffPath: string;
	filesPath: string;
	createdAt: string;
}

export type CommentSide = 'old' | 'new' | 'file';

export interface ReviewCommentRecord {
	id: string;
	reviewId: string;
	version: number;
	filePath: string | null;
	side: CommentSide;
	lineStart: number | null;
	lineEnd: number | null;
	body: string;
	author: string;
	status: 'open' | 'resolved';
	createdAt: string;
	updatedAt: string;
}
