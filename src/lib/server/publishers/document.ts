import { readFileSync } from 'node:fs';
import path from 'node:path';

export type DocumentReviewSource = {
	filePath: string;
	format?: 'markdown' | 'text' | 'html';
};

export function captureDocumentReviewSource(source: DocumentReviewSource) {
	const sourcePath = path.resolve(source.filePath);
	const content = readFileSync(sourcePath, 'utf8');
	return {
		sourcePath,
		content,
		format: source.format ?? 'markdown',
		lineCount: content.split('\n').length
	};
}
