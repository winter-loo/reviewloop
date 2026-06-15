import { captureCommitDiff, captureRangeDiff, captureShowDiff, captureStagedDiff, captureWorktreeDiff, getCommitSummary, listRangeCommits, type GitCommitSummary } from '../git/git';
import type { ReviewSourceKind } from '../storage/types';

export type GitReviewSource = {
	repoRoot: string;
	sourceKind: Exclude<ReviewSourceKind, 'document'>;
	sourceRef?: string | null;
};

export async function captureGitReviewDiff(source: GitReviewSource) {
	if (source.sourceKind === 'worktree') return captureWorktreeDiff(source.repoRoot);
	if (source.sourceKind === 'staged') return captureStagedDiff(source.repoRoot);
	if (source.sourceKind === 'range') {
		if (!source.sourceRef) throw new Error('sourceRef is required for range reviews');
		return captureRangeDiff(source.repoRoot, source.sourceRef);
	}
	if (source.sourceKind === 'show') {
		if (!source.sourceRef) throw new Error('sourceRef is required for show reviews');
		return captureShowDiff(source.repoRoot, source.sourceRef);
	}
	throw new Error(`Unsupported git review source kind: ${source.sourceKind}`);
}

export async function captureGitCommitSections(source: GitReviewSource): Promise<Array<GitCommitSummary & { diff: string }>> {
	if (source.sourceKind === 'range' && source.sourceRef) {
		const commits = await listRangeCommits(source.repoRoot, source.sourceRef);
		return Promise.all(commits.map(async (commit) => ({ ...commit, diff: await captureCommitDiff(source.repoRoot, commit.sha) })));
	}
	if (source.sourceKind === 'show' && source.sourceRef) {
		const commit = await getCommitSummary(source.repoRoot, source.sourceRef);
		if (commit) return [{ ...commit, diff: await captureShowDiff(source.repoRoot, source.sourceRef) }];
	}
	return [];
}
