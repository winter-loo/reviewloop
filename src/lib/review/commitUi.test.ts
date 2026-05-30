import { describe, expect, it } from 'vitest';
import { getFileBadges, summarizeCommitMessage } from './commitUi';

describe('commit UI helpers', () => {
	it('keeps the full commit message available while deriving a short preview', () => {
		const message = '任务编号:T202604226103\n\n修改说明:统一SQL在侧边栏展示完整commit消息，commit选择区展示可读摘要。';

		const summary = summarizeCommitMessage(message, 24);

		expect(summary.full).toBe(message);
		expect(summary.preview).toBe('任务编号:T202604226103');
		expect(summary.hasMore).toBe(true);
	});

	it('keeps line breaks and trailing newline in the full display text', () => {
		const message = '任务编号:T202604226103\r\n修改说明:第一行\r\n\r\n- 子项 A\r\n- 子项 B\r\n';

		const summary = summarizeCommitMessage(message, 24);

		expect(summary.full).toBe('任务编号:T202604226103\n修改说明:第一行\n\n- 子项 A\n- 子项 B\n');
		expect(summary.preview).toBe('任务编号:T202604226103');
		expect(summary.hasMore).toBe(true);
	});

	it('falls back to subject when older reviews do not have a full message', () => {
		const summary = summarizeCommitMessage(undefined, 24, 'add b file');

		expect(summary.full).toBe('add b file');
		expect(summary.preview).toBe('add b file');
		expect(summary.hasMore).toBe(false);
	});

	it('classifies review files into compact file-list badges', () => {
		expect(getFileBadges({ path: 'src/lib/review/commitUi.ts', generatedLike: false, tooLarge: false })).toEqual(['code']);
		expect(getFileBadges({ path: 'src/lib/review/commitUi.test.ts', generatedLike: false, tooLarge: false })).toEqual(['tests']);
		expect(getFileBadges({ path: 'expected/oracle/case.out', generatedLike: true, tooLarge: true })).toEqual(['generated', 'large']);
	});
});
