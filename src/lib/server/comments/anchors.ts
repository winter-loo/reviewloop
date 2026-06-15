import type { ReviewCommentRecord } from '../storage/types';

export type ReviewAnchor =
	| { type: 'diff-line'; path: string; side: 'old' | 'new'; lineStart: number; lineEnd: number }
	| { type: 'document-line'; path: string; lineStart: number; lineEnd: number }
	| { type: 'file'; path: string }
	| { type: 'review' };

export function anchorFromLegacyComment(comment: ReviewCommentRecord, reviewKind?: 'code' | 'document'): ReviewAnchor {
	if (!comment.filePath) return { type: 'review' };
	if (!comment.lineStart) return { type: 'file', path: comment.filePath };
	const lineEnd = comment.lineEnd ?? comment.lineStart;
	if (reviewKind === 'document') {
		return { type: 'document-line', path: comment.filePath, lineStart: comment.lineStart, lineEnd };
	}
	return {
		type: 'diff-line',
		path: comment.filePath,
		side: comment.side === 'old' ? 'old' : 'new',
		lineStart: comment.lineStart,
		lineEnd
	};
}

export function commentWithAnchor(comment: ReviewCommentRecord, reviewKind?: 'code' | 'document') {
	return { ...comment, anchor: anchorFromLegacyComment(comment, reviewKind) };
}
