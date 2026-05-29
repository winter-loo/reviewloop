<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>LTSQL Reviews</title>
</svelte:head>

<main class="page">
	<header>
		<p class="eyebrow">LTSQL Review</p>
		<h1>Published local code reviews</h1>
		<p>Read-only snapshots of local LTSQL worktree, commit, and range diffs.</p>
	</header>

	{#if data.reviews.length === 0}
		<section class="empty">
			<h2>No reviews yet</h2>
			<pre>ltsql-review publish --repo &lt;git-root&gt; --range 'HEAD~4...HEAD' --title 'my review'</pre>
		</section>
	{:else}
		<ul class="reviews">
			{#each data.reviews as review}
				<li>
					<a href={`/reviews/${review.id}`}>
						<strong>{review.title}</strong>
						<span>{review.id} · {review.status} · {review.sourceKind}{review.sourceRef ? ` ${review.sourceRef}` : ''}</span>
						<code>{review.repoRoot}</code>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.page {
		max-width: 980px;
		margin: 0 auto;
		padding: 48px 24px;
		font-family: system-ui, sans-serif;
	}
	.eyebrow {
		color: #2563eb;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.reviews {
		list-style: none;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.reviews a,
	.empty {
		display: grid;
		gap: 8px;
		border: 1px solid #dbe3ef;
		border-radius: 12px;
		padding: 16px;
		color: inherit;
		text-decoration: none;
		background: #fff;
	}
	.reviews span,
	code {
		color: #64748b;
	}
	pre {
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: #0f172a;
		color: #e2e8f0;
	}
</style>
