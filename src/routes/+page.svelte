<svelte:head>
	<title>LTSQL Review Platform</title>
</svelte:head>

<main class="hero">
	<p class="eyebrow">LTSQL local review</p>
	<h1>Publish local worktree diffs without pushing shared mainline.</h1>
	<p>
		Create safe, durable, browser-readable review snapshots from local LTSQL worktrees, commits,
		or ranges. Review comments are persisted separately from source worktrees.
	</p>
	<a href="/reviews">Open reviews</a>
</main>

<style>
	.hero {
		max-width: 860px;
		margin: 0 auto;
		padding: 72px 24px;
		font-family: system-ui, sans-serif;
	}
	.eyebrow {
		color: #2563eb;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	h1 {
		font-size: clamp(2.4rem, 7vw, 5rem);
		line-height: 1;
	}
	p {
		font-size: 1.2rem;
		color: #475569;
	}
	a {
		display: inline-flex;
		margin-top: 20px;
		padding: 12px 18px;
		border-radius: 999px;
		background: #2563eb;
		color: white;
		font-weight: 700;
		text-decoration: none;
	}
</style>
