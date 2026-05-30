export interface CommitMessageSummary {
	full: string;
	preview: string;
	hasMore: boolean;
}

export interface BadgeableReviewFile {
	path: string;
	generatedLike?: boolean;
	tooLarge?: boolean;
}

/**
 * Normalize commit messages for the review UI. The full text is always kept for
 * detail panels, while the preview is the first non-empty line for compact cards.
 */
export function summarizeCommitMessage(message?: string, maxPreviewLength = 80, fallbackSubject = ''): CommitMessageSummary {
	// Preserve the exact display shape of real commit bodies while normalizing CRLF
	// to LF so browser <pre> rendering is consistent across platforms.
	const normalizedMessage = message ? message.replace(/\r\n?/g, '\n') : '';
	const full = normalizedMessage.length > 0 ? normalizedMessage : fallbackSubject.trim();
	const firstLine = full
		.split('\n')
		.map((line) => line.trim())
		.find(Boolean) ?? '';
	const preview = firstLine.length > maxPreviewLength ? `${firstLine.slice(0, Math.max(0, maxPreviewLength - 1))}…` : firstLine;
	return {
		full,
		preview,
		hasMore: full.includes('\n') || firstLine.length > preview.length
	};
}

/**
 * Small, stable labels for the dense file pane. Generated/large labels win over
 * language labels so noisy files are immediately obvious while scanning.
 */
export function getFileBadges(file: BadgeableReviewFile): string[] {
	const badges: string[] = [];
	if (file.generatedLike) badges.push('generated');
	if (file.tooLarge) badges.push('large');
	if (badges.length > 0) return badges;
	if (/(^|\/)(test|tests|sql|case|cases)(\/|$)/i.test(file.path) || /(_test|\.test|\.spec)\./i.test(file.path)) return ['tests'];
	if (/\.(java|ts|js|svelte|sh|sql|xml|properties|md)$/i.test(file.path)) return ['code'];
	return ['other'];
}
