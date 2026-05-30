import { describe, expect, it } from 'vitest';
import { parseDiffFileSections } from './diffStats';

describe('parseDiffFileSections', () => {
	it('splits a unified diff into per-file sections with review metadata', () => {
		const diff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'index 111..222 100644',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1 +1,2 @@',
			' old',
			'+new',
			'diff --git a/expected/b.out b/expected/b.out',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/expected/b.out',
			'@@ -0,0 +1,4 @@',
			'+one',
			'+two',
			'+three',
			'+four'
		].join('\n');

		const files = parseDiffFileSections(diff, { largePatchBytes: 40, largeLineCount: 10 });

		expect(files).toHaveLength(2);
		expect(files[0]).toMatchObject({
			id: '000001',
			path: 'src/a.ts',
			additions: 1,
			deletions: 0,
			status: 'modified',
			generatedLike: false,
			tooLarge: true
		});
		expect(files[0].patch).toContain('diff --git a/src/a.ts b/src/a.ts');
		expect(files[1]).toMatchObject({
			id: '000002',
			path: 'expected/b.out',
			additions: 4,
			deletions: 0,
			status: 'added',
			generatedLike: true,
			tooLarge: true
		});
	});

	it('does not mark small expected output diffs as large just because they are generated-like', () => {
		const diff = [
			'diff --git a/unisql/unisql/cases/oracle/data_expected/oracle/dml-precompiled-sql-test-30629.out b/unisql/unisql/cases/oracle/data_expected/oracle/dml-precompiled-sql-test-30629.out',
			'index 111..222 100644',
			'--- a/unisql/unisql/cases/oracle/data_expected/oracle/dml-precompiled-sql-test-30629.out',
			'+++ b/unisql/unisql/cases/oracle/data_expected/oracle/dml-precompiled-sql-test-30629.out',
			'@@ -1,2 +1,2 @@',
			'-old masked line',
			'+new masked line'
		].join('\n');

		const [file] = parseDiffFileSections(diff);

		expect(file).toMatchObject({
			path: 'unisql/unisql/cases/oracle/data_expected/oracle/dml-precompiled-sql-test-30629.out',
			generatedLike: true,
			tooLarge: false
		});
	});

	it('treats patches under 1 MiB as small even when they have many lines', () => {
		const diff = [
			'diff --git a/expected/many-lines.out b/expected/many-lines.out',
			'index 111..222 100644',
			'--- a/expected/many-lines.out',
			'+++ b/expected/many-lines.out',
			'@@ -1,3100 +1,3100 @@',
			...Array.from({ length: 3100 }, (_, index) => ` line ${index}`)
		].join('\n');

		const [file] = parseDiffFileSections(diff);

		expect(file.patchBytes).toBeLessThan(1024 * 1024);
		expect(file.lineCount).toBeGreaterThan(3000);
		expect(file).toMatchObject({
			generatedLike: true,
			tooLarge: false
		});
	});
});
