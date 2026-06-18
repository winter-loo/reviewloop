import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pageSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.svelte'), 'utf8');
const serverSource = readFileSync(resolve('src/routes/document-reviews/[id]/+page.server.ts'), 'utf8');

describe('document review page markup', () => {
	it('renders comment controls as server-backed progressive forms', () => {
		expect(pageSource).not.toContain('$effect(() => {\n\t\tcomments = [...(data.comments as ReviewComment[])];\n\t});');
		expect(pageSource).not.toContain('toLocaleString()');
		expect(pageSource).not.toContain('onclick={() => startComment');
		expect(pageSource).not.toContain('onsubmit={(event)');

		expect(pageSource).toContain('{formatCommentTime(comment.createdAt)}');
		expect(pageSource).toContain('{#each renderedBlocks as block (block.id)}');
		expect(pageSource).toContain('<div class="md-review-item">');
		expect(pageSource).toContain('href={`?commentLine=${block.lineStart}#${block.id}`}');
		expect(pageSource).toContain('method="POST" action={`?/addComment#${block.id}`}');
		expect(pageSource).toContain('name="lineStart" value={block.lineStart}');
		expect(pageSource).toMatch(/<div class="md-review-item">[\s\S]*<section class="md-block"[\s\S]*commentsForLine\(block\.lineStart\)[\s\S]*activeLine === block\.lineStart[\s\S]*<\/div>\s*{\/each}/);
	});

	it('renders a left sidebar section-title navigation from markdown headings', () => {
		expect(pageSource).toContain('const sectionLinks = $derived(renderedBlocks.filter(hasHeading));');
		expect(pageSource).toContain('<aside class="section-navigation" aria-label="Document section navigation">');
		expect(pageSource).toContain("<h2>{t('document.sections')}</h2>");
		expect(pageSource).toContain('{#each sectionLinks as section (section.id)}');
		expect(pageSource).toContain('href={`#${section.id}`}');
		expect(pageSource).toContain('{section.headingText}');
		expect(pageSource).toContain('class:subsection={section.headingLevel > 2}');
		expect(pageSource).toContain('data-section-link={section.id}');
		expect(pageSource).toContain("document.querySelectorAll('[data-section-anchor]')");
		expect(pageSource).toContain("link.setAttribute('aria-current', 'location')");
		expect(pageSource).toContain('grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;');
		expect(pageSource).toContain('max-height: calc(100vh - 36px);');
		expect(pageSource).toContain('overflow-y: auto;');
	});

	it('uses the full viewport width with compact gutters', () => {
		expect(pageSource).not.toContain('max-width: 1440px;');
		expect(pageSource).not.toContain('margin: 0 auto;');
		expect(pageSource).toContain('width: 100%;');
		expect(pageSource).toContain('padding: 16px;');
		expect(pageSource).toContain('grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;');
		expect(pageSource).toContain('gap: 12px;');
	});

	it('supports opening and submitting comments without client-side hydration', () => {
		expect(serverSource).toContain("url.searchParams.get('commentLine')");
		expect(serverSource).toContain('export const actions: Actions');
		expect(serverSource).toContain('addComment: async');
		expect(serverSource).toContain('store.addComment');
		expect(serverSource).toContain('throw redirect(303');
	});
});
