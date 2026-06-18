<script lang="ts">
	import ReviewHero from '$lib/components/review/ReviewHero.svelte';
	import { createTranslator, type MessageKey } from '$lib/i18n/translate';
	import type { Locale } from '$lib/i18n/locales';

	let { data, form } = $props();

	type ReviewComment = {
		id: string;
		reviewId: string;
		version: number;
		filePath: string | null;
		side: 'old' | 'new' | 'file';
		lineStart: number | null;
		lineEnd: number | null;
		body: string;
		author: string;
		status: 'open' | 'resolved';
		createdAt: string;
		updatedAt: string;
	};

	type RenderedMarkdownBlock = {
		id: string;
		lineStart: number;
		lineEnd: number;
		html: string;
		headingLevel: number | null;
		headingText: string | null;
	};

	const markdownPath = $derived(data.document.path as string);
	const renderedBlocks = $derived((data.renderedBlocks as RenderedMarkdownBlock[]) ?? []);
	const lineCount = $derived((data.document.lineCount as number) ?? 0);
	const comments = $derived((data.comments as ReviewComment[]) ?? []);
	const activeLine = $derived(((form as { activeLine?: number | null } | null | undefined)?.activeLine) ?? ((data as typeof data & { activeLine?: number | null }).activeLine) ?? null);
	const formError = $derived(((form as { formError?: string | null } | null | undefined)?.formError) ?? null);
	const openComments = $derived(comments.filter((comment) => comment.status === 'open'));
	const sectionLinks = $derived(renderedBlocks.filter(hasHeading));
	const formErrorKey = $derived(((form as { formErrorKey?: MessageKey | null } | null | undefined)?.formErrorKey) ?? null);
	const t = $derived(createTranslator((data as typeof data & { locale: Locale }).locale));

	function hasHeading(block: RenderedMarkdownBlock): block is RenderedMarkdownBlock & { headingLevel: number; headingText: string } {
		return Boolean(block.headingText && block.headingLevel);
	}

	function lineRangeLabel(block: RenderedMarkdownBlock) {
		return block.lineStart === block.lineEnd ? String(block.lineStart) : `${block.lineStart}-${block.lineEnd}`;
	}

	function lineLabel(line: number | null) {
		return t('line.one', { line: line ?? '' });
	}

	function commentsForLine(line: number) {
		return openComments.filter((comment) => comment.filePath === markdownPath && comment.side === 'new' && comment.lineStart === line);
	}

	function formatCommentTime(timestamp: string) {
		return new Date(timestamp).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
	}
</script>

<svelte:head>
	<title>{t('review.documentTitle', { id: data.review.id })}</title>
	<script>
		(() => {
			const startSectionNavigation = () => {
				const activateSection = (sectionId) => {
					const links = document.querySelectorAll('.section-navigation a[data-section-link]');
					links.forEach((link) => {
						const isCurrent = link.dataset.sectionLink === sectionId;
						link.classList.toggle('current', isCurrent);
						if (isCurrent) {
							link.setAttribute('aria-current', 'location');
							link.scrollIntoView({ block: 'nearest' });
						} else {
							link.removeAttribute('aria-current');
						}
					});
				};

				const sectionAnchors = [...document.querySelectorAll('[data-section-anchor]')];
				if (sectionAnchors.length === 0) return;

				const activateFromHash = () => {
					const targetId = location.hash.slice(1);
					if (!targetId) {
						activateSection(sectionAnchors[0].dataset.sectionAnchor);
						return;
					}

					const target = document.getElementById(targetId);
					const targetLine = Number(target?.dataset.lineStart);
					const current = sectionAnchors
						.filter((anchor) => Number(anchor.dataset.lineStart) <= targetLine)
						.at(-1);
					activateSection(current?.dataset.sectionAnchor ?? targetId);
				};

				const observer = new IntersectionObserver(
					(entries) => {
						const visible = entries
							.filter((entry) => entry.isIntersecting)
							.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
						if (visible?.target instanceof HTMLElement) {
							activateSection(visible.target.dataset.sectionAnchor);
						}
					},
					{ rootMargin: '-18% 0px -70% 0px', threshold: 0 }
				);

				sectionAnchors.forEach((anchor) => observer.observe(anchor));
				activateFromHash();
				window.addEventListener('hashchange', activateFromHash);
			};

			if (document.readyState === 'loading') {
				document.addEventListener('DOMContentLoaded', startSectionNavigation, { once: true });
			} else {
				startSectionNavigation();
			}
		})();
	</script>
</svelte:head>

<main class="page">
	<nav><a href="/reviews">{t('review.backToReviews')}</a></nav>
	<ReviewHero
		eyebrow={t('review.markdownEyebrow', { id: data.review.id })}
		title={data.review.title}
		meta={[t('review.meta.version', { version: data.latestVersion.version }), t('review.meta.lines', { count: lineCount }), t('review.meta.openComments', { count: openComments.length })]}
		codeText={markdownPath}
	>
		<p class="hint">{t('document.agentHint')} <code>reviewctl comments --review {data.review.id} --json</code>.</p>
	</ReviewHero>

	<section class="review-layout">
		<aside class="section-navigation" aria-label="Document section navigation">
			<h2>{t('document.sections')}</h2>
			{#if sectionLinks.length === 0}
				<p>{t('document.noSections')}</p>
			{:else}
				<ul>
					{#each sectionLinks as section (section.id)}
						<li class:subsection={section.headingLevel > 2}>
							<a href={`#${section.id}`} data-section-link={section.id}>{section.headingText}</a>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>

		<article class="markdown-card" aria-label="Markdown design document">
			{#each renderedBlocks as block (block.id)}
				<div class="md-review-item">
					<section class="md-block" class:active={activeLine === block.lineStart} data-section-anchor={block.headingText ? block.id : undefined} data-line-start={block.lineStart}>
						<a class="add-comment" href={`?commentLine=${block.lineStart}#${block.id}`} title={t('comment.onLine', { line: block.lineStart })}>+</a>
						<a class="line-number" href={`#${block.id}`} id={block.id} data-line-start={block.lineStart}>{lineRangeLabel(block)}</a>
						<div class="md-content">{@html block.html}</div>
					</section>
					{#each commentsForLine(block.lineStart) as comment (comment.id)}
						<section class="comment-thread">
							<strong>{comment.author}</strong>
							<span>{formatCommentTime(comment.createdAt)}</span>
							<p>{comment.body}</p>
						</section>
					{/each}
					{#if activeLine === block.lineStart}
						<form class="comment-composer" method="POST" action={`?/addComment#${block.id}`}>
							<input type="hidden" name="filePath" value={markdownPath} />
							<input type="hidden" name="side" value="new" />
							<input type="hidden" name="lineStart" value={block.lineStart} />
							<input type="hidden" name="lineEnd" value={block.lineStart} />
							<label>{t('comment.author')} <input name="author" value="reviewer" /></label>
							<label>{t('comment.onLine', { line: block.lineStart })}<textarea name="body" rows="4" placeholder={t('comment.placeholder')}></textarea></label>
							{#if formErrorKey}<p class="error">{t(formErrorKey)}</p>{:else if formError}<p class="error">{formError}</p>{/if}
							<div class="composer-actions">
								<button type="submit">{t('comment.save')}</button>
								<a class="secondary" href={`#${block.id}`}>{t('common.cancel')}</a>
							</div>
						</form>
					{/if}
				</div>
			{/each}
		</article>

		<aside class="comment-overview">
			<h2>{t('document.openComments')}</h2>
			{#if openComments.length === 0}
				<p>{t('document.noComments')}</p>
			{:else}
				<ul>
					{#each openComments as comment}
						<li>
							<a href={`#L${comment.lineStart}`}>{lineLabel(comment.lineStart)}</a>
							<strong>{comment.author}</strong>
							<span>{comment.body}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f8fafc;
		color: #0f172a;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	:global(*) {
		box-sizing: border-box;
	}
	.page {
		width: 100%;
		padding: 16px;
	}
	nav a {
		color: #2563eb;
		font-weight: 700;
		text-decoration: none;
	}
	code {
		word-break: break-all;
		color: #334155;
	}
	.hint {
		margin-bottom: 0;
		color: #64748b;
	}
	.review-layout {
		display: grid;
		grid-template-columns: minmax(320px, 18vw) minmax(0, 1fr) 340px;
		gap: 12px;
		align-items: start;
		margin-top: 12px;
	}
	.markdown-card,
	.section-navigation,
	.comment-overview {
		border: 1px solid #dbe3ef;
		border-radius: 18px;
		background: white;
		box-shadow: 0 14px 40px rgba(15, 23, 42, 0.06);
	}
	.markdown-card {
		padding: 16px 0;
		overflow: hidden;
	}
	.md-block {
		display: grid;
		grid-template-columns: 36px 64px minmax(0, 1fr);
		gap: 8px;
		align-items: start;
		padding: 4px 20px;
	}
	.md-block:hover,
	.md-block.active {
		background: #f1f5f9;
	}
	.add-comment {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: white;
		color: #2563eb;
		font-weight: 900;
		text-decoration: none;
		cursor: pointer;
		opacity: 0.35;
	}
	.md-block:hover .add-comment,
	.md-block.active .add-comment {
		opacity: 1;
	}
	.line-number {
		padding-top: 4px;
		color: #94a3b8;
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.85rem;
		text-align: right;
		text-decoration: none;
	}
	.md-content {
		min-width: 0;
		word-break: break-word;
		font-size: 1rem;
		line-height: 1.65;
	}
	.md-content :global(*) {
		box-sizing: border-box;
	}
	.md-content :global(h1),
	.md-content :global(h2),
	.md-content :global(h3),
	.md-content :global(h4) {
		margin: 1.1em 0 0.45em;
		line-height: 1.25;
		font-weight: 800;
	}
	.md-content :global(h1) {
		font-size: 2rem;
		padding-bottom: 0.25em;
		border-bottom: 1px solid #e2e8f0;
	}
	.md-content :global(h2) {
		font-size: 1.55rem;
		padding-bottom: 0.2em;
		border-bottom: 1px solid #eef2f7;
	}
	.md-content :global(h3) {
		font-size: 1.25rem;
	}
	.md-content :global(p),
	.md-content :global(ul),
	.md-content :global(ol),
	.md-content :global(blockquote),
	.md-content :global(pre),
	.md-content :global(table) {
		margin: 0.65em 0;
	}
	.md-content :global(ul),
	.md-content :global(ol) {
		padding-left: 1.6rem;
	}
	.md-content :global(li + li) {
		margin-top: 0.25rem;
	}
	.md-content :global(blockquote) {
		padding: 0.3rem 0 0.3rem 1rem;
		border-left: 4px solid #bfdbfe;
		color: #475569;
	}
	.md-content :global(pre) {
		overflow-x: auto;
		padding: 14px 16px;
		border-radius: 12px;
		background: #0f172a;
		color: #e2e8f0;
	}
	.md-content :global(code) {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.92em;
	}
	.md-content :global(:not(pre) > code) {
		padding: 0.12rem 0.32rem;
		border-radius: 6px;
		background: #e2e8f0;
		color: #0f172a;
	}
	.md-content :global(table) {
		width: 100%;
		border-collapse: collapse;
		display: block;
		overflow-x: auto;
	}
	.md-content :global(th),
	.md-content :global(td) {
		padding: 8px 10px;
		border: 1px solid #cbd5e1;
		vertical-align: top;
	}
	.md-content :global(th) {
		background: #f1f5f9;
		font-weight: 800;
	}
	.md-content :global(a) {
		color: #2563eb;
		font-weight: 700;
	}
	.comment-thread,
	.comment-composer {
		margin: 8px 20px 12px 128px;
		padding: 12px;
		border-left: 4px solid #2563eb;
		border-radius: 10px;
		background: #eff6ff;
	}
	.comment-thread strong {
		margin-right: 8px;
	}
	.comment-thread span {
		color: #64748b;
		font-size: 0.85rem;
	}
	.comment-thread p {
		margin: 8px 0 0;
		white-space: pre-wrap;
	}
	.comment-composer {
		display: grid;
		gap: 10px;
	}
	.comment-composer label {
		display: grid;
		gap: 6px;
		font-weight: 700;
	}
	.comment-composer input,
	.comment-composer textarea {
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #cbd5e1;
		border-radius: 10px;
		padding: 10px;
		font: inherit;
	}
	.composer-actions {
		display: flex;
		gap: 8px;
	}
	button {
		font: inherit;
	}
	.composer-actions button,
	.composer-actions a {
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: #2563eb;
		color: white;
		font-weight: 800;
		text-decoration: none;
		cursor: pointer;
	}
	.composer-actions .secondary {
		background: #e2e8f0;
		color: #0f172a;
	}
	.error {
		margin: 0;
		color: #b91c1c;
		font-weight: 700;
	}
	.comment-overview {
		position: sticky;
		top: 18px;
		padding: 18px;
	}
	.section-navigation {
		position: sticky;
		top: 18px;
		padding: 16px;
		max-height: calc(100vh - 36px);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
	}
	.section-navigation h2,
	.comment-overview h2 {
		margin-top: 0;
	}
	.section-navigation p,
	.comment-overview p {
		color: #64748b;
	}
	.section-navigation ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.section-navigation li {
		border-radius: 10px;
	}
	.section-navigation li.subsection {
		padding-left: 14px;
	}
	.section-navigation a {
		display: block;
		padding: 8px 10px;
		border-radius: 10px;
		color: #334155;
		font-weight: 750;
		line-height: 1.25;
		text-decoration: none;
	}
	.section-navigation a:hover,
	.section-navigation :global(a.current),
	.section-navigation :global(a[aria-current='location']) {
		background: #eff6ff;
		color: #2563eb;
	}
	.section-navigation :global(a.current),
	.section-navigation :global(a[aria-current='location']) {
		box-shadow: inset 3px 0 0 #2563eb;
		font-weight: 850;
	}
	.comment-overview ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.comment-overview li {
		display: grid;
		gap: 4px;
		padding: 10px;
		border: 1px solid #dbe3ef;
		border-radius: 10px;
	}
	.comment-overview a {
		color: #2563eb;
		font-weight: 800;
		text-decoration: none;
	}
	.comment-overview span {
		color: #475569;
	}
	@media (max-width: 980px) {
		.review-layout {
			grid-template-columns: 1fr;
		}
		.comment-overview,
		.section-navigation {
			position: static;
		}
	}
</style>
