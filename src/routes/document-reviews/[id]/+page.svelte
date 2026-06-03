<script lang="ts">
	let { data } = $props();

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

	type MarkdownLine = {
		number: number;
		text: string;
		kind: 'heading1' | 'heading2' | 'heading3' | 'list' | 'quote' | 'code' | 'table' | 'blank' | 'paragraph';
	};

	let comments = $state<ReviewComment[]>([]);
	let commentAuthor = $state('reviewer');
	let activeLine = $state<number | null>(null);
	let commentBody = $state('');
	let commentError = $state<string | null>(null);
	let commentSubmitting = $state(false);

	const markdownPath = $derived(data.document.path as string);
	const markdownLines = $derived(parseMarkdownLines(data.markdown as string));
	const openComments = $derived(comments.filter((comment) => comment.status === 'open'));

	function parseMarkdownLines(markdown: string): MarkdownLine[] {
		let inFence = false;
		return markdown.split('\n').map((line, index) => {
			if (/^```/.test(line.trim())) {
				inFence = !inFence;
				return { number: index + 1, text: line, kind: 'code' };
			}
			if (inFence) return { number: index + 1, text: line, kind: 'code' };
			if (!line.trim()) return { number: index + 1, text: line, kind: 'blank' };
			if (/^#\s+/.test(line)) return { number: index + 1, text: line.replace(/^#\s+/, ''), kind: 'heading1' };
			if (/^##\s+/.test(line)) return { number: index + 1, text: line.replace(/^##\s+/, ''), kind: 'heading2' };
			if (/^###\s+/.test(line)) return { number: index + 1, text: line.replace(/^###\s+/, ''), kind: 'heading3' };
			if (/^>\s?/.test(line)) return { number: index + 1, text: line.replace(/^>\s?/, ''), kind: 'quote' };
			if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) return { number: index + 1, text: line, kind: 'list' };
			if (line.includes('|')) return { number: index + 1, text: line, kind: 'table' };
			return { number: index + 1, text: line, kind: 'paragraph' };
		});
	}

	function commentsForLine(line: number) {
		return openComments.filter((comment) => comment.filePath === markdownPath && comment.side === 'new' && comment.lineStart === line);
	}

	function startComment(line: number) {
		activeLine = line;
		commentBody = '';
		commentError = null;
	}

	function cancelComment() {
		activeLine = null;
		commentBody = '';
		commentError = null;
	}

	async function submitComment(line: number) {
		commentError = null;
		const body = commentBody.trim();
		if (!body) {
			commentError = 'Comment body is required.';
			return;
		}
		commentSubmitting = true;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/comments`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filePath: markdownPath,
					side: 'new',
					lineStart: line,
					lineEnd: line,
					body,
					author: commentAuthor.trim() || 'reviewer'
				})
			});
			if (!response.ok) throw new Error(await response.text());
			const payload = (await response.json()) as { comment: ReviewComment };
			comments = [...comments, payload.comment];
			cancelComment();
		} catch (cause) {
			commentError = cause instanceof Error ? cause.message : 'Unable to add comment';
		} finally {
			commentSubmitting = false;
		}
	}

	$effect(() => {
		comments = [...(data.comments as ReviewComment[])];
	});
</script>

<svelte:head>
	<title>{data.review.id} · Document Review</title>
</svelte:head>

<main class="page">
	<nav><a href="/reviews">← Reviews</a></nav>
	<header class="hero">
		<p class="eyebrow">{data.review.id} · markdown document review</p>
		<h1>{data.review.title}</h1>
		<div class="meta">
			<span>v{data.latestVersion.version}</span>
			<span>{markdownLines.length} lines</span>
			<span>{openComments.length} open comments</span>
		</div>
		<code>{markdownPath}</code>
		<p class="hint">Comments are persisted through the shared review comment API/CLI, so Hermes can read them with <code>ltsql-review comments --review {data.review.id} --json</code>.</p>
	</header>

	<section class="review-layout">
		<article class="markdown-card" aria-label="Markdown design document">
			{#each markdownLines as line}
				<section class="md-row" class:active={activeLine === line.number}>
					<button class="add-comment" title={`Comment on line ${line.number}`} onclick={() => startComment(line.number)}>+</button>
					<a class="line-number" href={`#L${line.number}`} id={`L${line.number}`}>{line.number}</a>
					<div class="md-content {line.kind}">{line.text || ' '}</div>
				</section>
				{#each commentsForLine(line.number) as comment}
					<section class="comment-thread">
						<strong>{comment.author}</strong>
						<span>{new Date(comment.createdAt).toLocaleString()}</span>
						<p>{comment.body}</p>
					</section>
				{/each}
				{#if activeLine === line.number}
					<form class="comment-composer" onsubmit={(event) => { event.preventDefault(); void submitComment(line.number); }}>
						<label>Author <input bind:value={commentAuthor} /></label>
						<label>Comment on line {line.number}<textarea bind:value={commentBody} rows="4" placeholder="Add a review comment that Hermes can read via comments --json"></textarea></label>
						{#if commentError}<p class="error">{commentError}</p>{/if}
						<div class="composer-actions">
							<button type="submit" disabled={commentSubmitting}>{commentSubmitting ? 'Saving…' : 'Save comment'}</button>
							<button type="button" class="secondary" onclick={cancelComment}>Cancel</button>
						</div>
					</form>
				{/if}
			{/each}
		</article>

		<aside class="comment-overview">
			<h2>Open comments</h2>
			{#if openComments.length === 0}
				<p>No comments yet.</p>
			{:else}
				<ul>
					{#each openComments as comment}
						<li>
							<a href={`#L${comment.lineStart}`}>Line {comment.lineStart}</a>
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
	.page {
		max-width: 1440px;
		margin: 0 auto;
		padding: 28px;
	}
	nav a {
		color: #2563eb;
		font-weight: 700;
		text-decoration: none;
	}
	.hero {
		margin-top: 20px;
		padding: 24px;
		border: 1px solid #dbe3ef;
		border-radius: 18px;
		background: white;
		box-shadow: 0 14px 40px rgba(15, 23, 42, 0.08);
	}
	.eyebrow {
		margin: 0 0 8px;
		color: #2563eb;
		font-weight: 800;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0;
		font-size: clamp(1.8rem, 3vw, 3rem);
	}
	.meta {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin: 16px 0;
		color: #475569;
	}
	.meta span {
		padding: 6px 10px;
		border-radius: 999px;
		background: #eef2ff;
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
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 20px;
		align-items: start;
		margin-top: 20px;
	}
	.markdown-card,
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
	.md-row {
		display: grid;
		grid-template-columns: 36px 64px minmax(0, 1fr);
		gap: 8px;
		align-items: start;
		padding: 2px 20px;
	}
	.md-row:hover,
	.md-row.active {
		background: #f1f5f9;
	}
	.add-comment {
		width: 26px;
		height: 26px;
		border: 1px solid #cbd5e1;
		border-radius: 999px;
		background: white;
		color: #2563eb;
		font-weight: 900;
		cursor: pointer;
		opacity: 0.35;
	}
	.md-row:hover .add-comment,
	.md-row.active .add-comment {
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
		min-height: 1.45em;
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 1rem;
		line-height: 1.55;
	}
	.heading1 {
		font-size: 1.8rem;
		font-weight: 850;
		line-height: 1.25;
		padding: 18px 0 8px;
	}
	.heading2 {
		font-size: 1.45rem;
		font-weight: 800;
		padding: 16px 0 6px;
	}
	.heading3 {
		font-size: 1.2rem;
		font-weight: 760;
		padding: 12px 0 4px;
	}
	.list {
		padding-left: 16px;
	}
	.quote {
		padding-left: 14px;
		border-left: 4px solid #bfdbfe;
		color: #475569;
	}
	.code {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.92rem;
		background: #0f172a;
		color: #e2e8f0;
		padding: 2px 8px;
	}
	.table {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
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
	.composer-actions button {
		padding: 9px 12px;
		border: 0;
		border-radius: 10px;
		background: #2563eb;
		color: white;
		font-weight: 800;
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
	.comment-overview h2 {
		margin-top: 0;
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
		.comment-overview {
			position: static;
		}
	}
</style>
