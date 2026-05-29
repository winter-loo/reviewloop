<script lang="ts">
	let { data } = $props();
	const diffLines = $derived(data.diff.split('\n'));
	const latestVersion = $derived(data.latestVersion!);
</script>

<svelte:head>
	<title>{data.review.id} · LTSQL Review</title>
</svelte:head>

<main class="page">
	<nav><a href="/reviews">← Reviews</a></nav>
	<header>
		<p class="eyebrow">{data.review.id} · {data.review.status}</p>
		<h1>{data.review.title}</h1>
		<div class="meta">
			<span>{data.review.sourceKind}{data.review.sourceRef ? ` ${data.review.sourceRef}` : ''}</span>
			<span>v{latestVersion.version}</span>
			<span>{data.files.length} files</span>
		</div>
		<code>{data.review.repoRoot}</code>
	</header>

	<section class="layout">
		<aside>
			<h2>Files</h2>
			<ul>
				{#each data.files as file}
					<li><code>{file.path}</code><span>+{file.additions} -{file.deletions}</span></li>
				{/each}
			</ul>
		</aside>
		<section class="diff">
			<h2>Unified diff</h2>
			<pre>{#each diffLines as line}<span class:added={line.startsWith('+') && !line.startsWith('+++')} class:deleted={line.startsWith('-') && !line.startsWith('---')} class:header={line.startsWith('diff --git') || line.startsWith('@@')}>{line}</span>{'\n'}{/each}</pre>
		</section>
	</section>

	<section class="comments">
		<h2>Comments</h2>
		{#if data.comments.length === 0}
			<p>No comments yet. Use the comments API for MVP:</p>
			<pre>POST /api/reviews/{data.review.id}/comments</pre>
		{:else}
			{#each data.comments as comment}
				<article>
					<strong>{comment.author}</strong>
					<span>{comment.filePath ?? 'general'}:{comment.lineStart ?? ''}</span>
					<p>{comment.body}</p>
				</article>
			{/each}
		{/if}
	</section>
</main>

<style>
	.page {
		max-width: 1280px;
		margin: 0 auto;
		padding: 32px 24px;
		font-family: system-ui, sans-serif;
	}
	nav a {
		color: #2563eb;
		text-decoration: none;
	}
	.eyebrow,
	.meta {
		color: #64748b;
		font-weight: 600;
	}
	.meta {
		display: flex;
		gap: 16px;
		margin-bottom: 8px;
	}
	.layout {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 20px;
		align-items: start;
	}
	aside,
	.diff,
	.comments {
		border: 1px solid #dbe3ef;
		border-radius: 12px;
		padding: 16px;
		background: #fff;
	}
	aside ul {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	aside li {
		display: grid;
		gap: 4px;
		font-size: 0.9rem;
	}
	pre {
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: #0f172a;
		color: #dbeafe;
		line-height: 1.45;
	}
	pre span {
		display: block;
		white-space: pre;
	}
	.added {
		color: #86efac;
	}
	.deleted {
		color: #fca5a5;
	}
	.header {
		color: #93c5fd;
		font-weight: 700;
	}
	.comments {
		margin-top: 20px;
	}
	article {
		border-top: 1px solid #e2e8f0;
		padding: 12px 0;
	}
	@media (max-width: 900px) {
		.layout {
			grid-template-columns: 1fr;
		}
	}
</style>
