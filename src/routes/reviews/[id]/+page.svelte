<script lang="ts">
	import { getFileBadges, summarizeCommitMessage } from '$lib/review/commitUi';

	let { data } = $props();

	type ReviewFile = {
		id?: string;
		path: string;
		oldPath?: string;
		additions: number;
		deletions: number;
		status: 'added' | 'deleted' | 'modified' | 'renamed';
		patchBytes?: number;
		lineCount?: number;
		tooLarge?: boolean;
		generatedLike?: boolean;
	};

	type ReviewCommit = {
		id: string;
		sha: string;
		shortSha: string;
		authorName: string;
		authorDate: string;
		subject: string;
		message?: string;
		files: ReviewFile[];
		additions: number;
		deletions: number;
		patchBytes: number;
		lineCount: number;
	};

	const latestVersion = $derived(data.latestVersion!);
	const commits = $derived((data.commits ?? []) as ReviewCommit[]);
	let selectedCommitId = $state('all');
	let search = $state('');
	let filter = $state<'important' | 'code' | 'tests' | 'generated' | 'large' | 'all'>('important');
	const filterOptions = ['important', 'code', 'tests', 'generated', 'large', 'all'] as const;
	let selectedFile = $state<ReviewFile | null>(null);
	let loadedDiffs = $state<Record<string, string>>({});
	let loadingFileId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let forceLarge = $state<Record<string, boolean>>({});
	let reviewed = $state<Record<string, boolean>>({});
	let scrollTop = $state(0);
	let viewportHeight = $state(720);

	const rowHeight = 20;
	const overscan = 40;

	function fileKey(file: ReviewFile) {
		return file.id ?? file.path;
	}

	function isTestFile(file: ReviewFile) {
		return /(^|\/)(test|tests|sql|case|cases)(\/|$)/i.test(file.path) || /(_test|\.test|\.spec)\./i.test(file.path);
	}

	function isCodeFile(file: ReviewFile) {
		return !file.generatedLike && !isTestFile(file) && /\.(java|ts|js|svelte|sh|sql|xml|properties|md)$/i.test(file.path);
	}

	function matchesFilter(file: ReviewFile) {
		if (filter === 'all') return true;
		if (filter === 'large') return Boolean(file.tooLarge);
		if (filter === 'generated') return Boolean(file.generatedLike);
		if (filter === 'tests') return isTestFile(file) && !file.generatedLike;
		if (filter === 'code') return isCodeFile(file);
		return !file.generatedLike && !file.tooLarge;
	}

	const selectedCommit = $derived(commits.find((commit) => commit.id === selectedCommitId) ?? null);
	const selectedCommitMessage = $derived(
		selectedCommit ? summarizeCommitMessage(selectedCommit.message, 120, selectedCommit.subject) : null
	);
	const commitFiles = $derived(selectedCommit ? selectedCommit.files : (data.files as ReviewFile[]));
	const filteredFiles = $derived(
		commitFiles.filter((file) => {
			const q = search.trim().toLowerCase();
			const matchesSearch = !q || file.path.toLowerCase().includes(q) || file.oldPath?.toLowerCase().includes(q);
			return matchesSearch && matchesFilter(file);
		})
	);

	const selectedKey = $derived(selectedFile ? fileKey(selectedFile) : '');
	const selectedDiff = $derived(selectedKey ? loadedDiffs[selectedKey] : '');
	const diffLines = $derived(selectedDiff ? selectedDiff.split('\n') : []);
	const visibleStart = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
	const visibleEnd = $derived(Math.min(diffLines.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan));
	const visibleLines = $derived(diffLines.slice(visibleStart, visibleEnd));

	function formatBytes(bytes = 0) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	function diffClass(line: string) {
		if (line.startsWith('+') && !line.startsWith('+++')) return 'added';
		if (line.startsWith('-') && !line.startsWith('---')) return 'deleted';
		if (line.startsWith('diff --git') || line.startsWith('@@')) return 'header';
		return '';
	}

	async function loadFile(file: ReviewFile, force = false) {
		selectedFile = file;
		loadError = null;
		scrollTop = 0;
		const key = fileKey(file);
		if (file.tooLarge && !force && !forceLarge[key]) return;
		if (loadedDiffs[key]) return;
		if (!file.id) {
			loadError = 'This review was published before per-file diff artifacts existed. Re-publish the review to enable lazy file loading.';
			return;
		}
		loadingFileId = key;
		try {
			const response = await fetch(`/api/reviews/${data.review.id}/versions/${latestVersion.version}/files/${file.id}/diff`);
			if (!response.ok) throw new Error(await response.text());
			const payload = await response.json();
			loadedDiffs = { ...loadedDiffs, [key]: payload.diff };
			forceLarge = { ...forceLarge, [key]: true };
		} catch (cause) {
			loadError = cause instanceof Error ? cause.message : 'Unable to load file diff';
		} finally {
			loadingFileId = null;
		}
	}

	function loadLargeFile(file: ReviewFile) {
		forceLarge = { ...forceLarge, [fileKey(file)]: true };
		void loadFile(file, true);
	}

	function markReviewed(file: ReviewFile) {
		const key = fileKey(file);
		reviewed = { ...reviewed, [key]: !reviewed[key] };
	}

	function selectCommit(commitId: string) {
		selectedCommitId = commitId;
		selectedFile = null;
		loadError = null;
		scrollTop = 0;
	}

	function hasActiveTextSelection() {
		// Button descendants are not text-selectable in some browsers by default;
		// once enabled via CSS, avoid treating a completed drag-selection as a click.
		return Boolean(window.getSelection()?.toString().trim());
	}

	function selectCommitFromClick(commitId: string) {
		if (hasActiveTextSelection()) return;
		selectCommit(commitId);
	}

	function commitReviewedCount(commit: ReviewCommit) {
		return commit.files.filter((file) => reviewed[fileKey(file)]).length;
	}

	function moveCommit(delta: number) {
		if (commits.length === 0) return;
		const ids = ['all', ...commits.map((commit) => commit.id)];
		const current = Math.max(0, ids.indexOf(selectedCommitId));
		const next = (current + delta + ids.length) % ids.length;
		selectCommit(ids[next]);
	}

	function onCommitKeydown(event: KeyboardEvent) {
		if (event.key === 'j' || event.key === 'ArrowDown') {
			event.preventDefault();
			moveCommit(1);
		}
		if (event.key === 'k' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveCommit(-1);
		}
	}

	function onDiffScroll(event: Event) {
		const target = event.currentTarget as HTMLElement;
		scrollTop = target.scrollTop;
		viewportHeight = target.clientHeight;
	}

	$effect(() => {
		const selectedStillVisible = selectedFile && filteredFiles.some((file) => fileKey(file) === fileKey(selectedFile!));
		if (!selectedStillVisible) {
			const nextFile = filteredFiles[0] ?? null;
			if (nextFile) {
				// Keep the detail pane in sync with the visible file list and load small
				// diffs immediately. Large files still stop in loadFile() and show the
				// explicit "Load large diff" affordance.
				void loadFile(nextFile);
			} else {
				selectedFile = null;
				loadError = null;
				scrollTop = 0;
			}
		}
	});
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
			<span>+{data.summary.additions} -{data.summary.deletions}</span>
			<span>{formatBytes(data.summary.patchBytes)} indexed</span>
		</div>
		<code>{data.review.repoRoot}</code>
		<div class="actions">
			<a class="button" href={`/api/reviews/${data.review.id}/raw.patch`}>Download raw patch</a>
			<span>{data.summary.largeFiles} &gt;1 MiB collapsed · {data.summary.generatedFiles} generated-like labeled</span>
		</div>
	</header>


	<section class="summary">
		<div>
			<strong>Metadata-first review</strong>
			<span>Diffs load on demand; only patches over 1 MiB stay collapsed, while generated-like files are labeled but still readable.</span>
		</div>
		<span class="shortcut-hint">Commit navigation: <kbd>j</kbd>/<kbd>k</kbd></span>
	</section>

	<section class="review-workspace" class:without-commits={commits.length === 0}>
		{#if commits.length > 0}
			<aside class="commit-rail" aria-label="Commit navigation">
				<div class="pane-head compact">
					<div>
						<p class="eyebrow">Commit range</p>
						<h2>{commits.length} commits</h2>
					</div>
					<span class="keyboard-pill">j/k</span>
				</div>

				<button class="commit-row all-row" class:active={selectedCommitId === 'all'} onclick={() => selectCommitFromClick('all')} onkeydown={onCommitKeydown}>
					<span class="commit-dot">∑</span>
					<span class="commit-main">
						<strong>All commits</strong>
						<small>{data.files.length} files · +{data.summary.additions} -{data.summary.deletions}</small>
					</span>
				</button>

				<div class="commit-list">
					{#each commits as commit, index}
						{@const message = summarizeCommitMessage(commit.message, 76, commit.subject)}
						{@const activeCommit = selectedCommitId === commit.id}
						{@const doneFiles = commitReviewedCount(commit)}
						<button class="commit-row" class:active={activeCommit} onclick={() => selectCommitFromClick(commit.id)} onkeydown={onCommitKeydown}>
							<span class="commit-dot">{doneFiles === commit.files.length ? '✓' : index + 1}</span>
							<span class="commit-main">
								<span class="commit-subject">{message.preview}</span>
								<span class="commit-facts">
									<code>{commit.shortSha}</code>
									<span>{commit.files.length} files</span>
									<span class="plus">+{commit.additions}</span>
									<span class="minus">-{commit.deletions}</span>
								</span>
								{#if activeCommit && selectedCommitMessage}
									<pre class="commit-message">{selectedCommitMessage.full}</pre>
								{/if}
							</span>
						</button>
					{/each}
				</div>
			</aside>
		{/if}

		<section class="file-pane">
			<div class="pane-head">
				<div>
					<p class="eyebrow">{selectedCommit ? 'Selected commit' : 'Whole review'}</p>
					<h2>{selectedCommit ? 'Files in selected commit' : 'Files'}</h2>
				</div>
				<span class="count-pill">{filteredFiles.length}/{commitFiles.length}</span>
			</div>

			<div class="file-toolbar">
				<input bind:value={search} placeholder="Search path" aria-label="Search files" />
				<div class="filters" aria-label="File filters">
					{#each filterOptions as option}
						<button class:active={filter === option} onclick={() => (filter = option)}>{option}</button>
					{/each}
				</div>
			</div>

			<ul class="file-list">
				{#each filteredFiles as file}
					<li class:selected={selectedFile && fileKey(selectedFile) === fileKey(file)} class:reviewed={reviewed[fileKey(file)]}>
						<button onclick={() => void loadFile(file)}>
							<span class="file-path">{file.path}</span>
							<span class="file-stats">
								<span class="plus">+{file.additions}</span>
								<span class="minus">-{file.deletions}</span>
								<span>{file.lineCount ?? '?'} lines</span>
								<span>{formatBytes(file.patchBytes)}</span>
							</span>
							<span class="badges">
								{#each getFileBadges(file) as badge}<em>{badge}</em>{/each}
								{#if reviewed[fileKey(file)]}<em class="reviewed-badge">reviewed</em>{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<section class="diff-panel">
			<div class="diff-header">
				<div>
					<p class="eyebrow">Diff viewer</p>
					<h2>{selectedFile?.path ?? 'Select a file'}</h2>
					{#if selectedFile?.oldPath}<p>renamed from {selectedFile.oldPath}</p>{/if}
				</div>
				{#if selectedFile}
					<div class="diff-actions">
						<button onclick={() => markReviewed(selectedFile!)}>{reviewed[fileKey(selectedFile)] ? 'Reviewed ✓' : 'Mark reviewed'}</button>
					</div>
				{/if}
			</div>

			{#if loadError}
				<p class="error">{loadError}</p>
			{:else if selectedFile?.tooLarge && !loadedDiffs[selectedKey]}
				<div class="collapsed">
					<h3>Diff over 1 MiB collapsed</h3>
					<p>{selectedFile.path} has {selectedFile.lineCount ?? '?'} lines / {formatBytes(selectedFile.patchBytes)}. Load it only if you really need the full text.</p>
					<button class="primary" onclick={() => selectedFile && loadLargeFile(selectedFile)}>Load large diff</button>
				</div>
			{:else if loadingFileId}
				<p class="loading">Loading file diff…</p>
			{:else if diffLines.length > 0}
				<div class="virtual-diff" onscroll={onDiffScroll}>
					<div style={`height: ${diffLines.length * rowHeight}px; position: relative;`}>
						<div style={`transform: translateY(${visibleStart * rowHeight}px);`}>
							{#each visibleLines as line, index}
								<div class={`diff-line ${diffClass(line)}`} style={`height: ${rowHeight}px;`}>
									<span class="line-no">{visibleStart + index + 1}</span><code>{line || ' '}</code>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{:else if selectedFile}
				<p class="empty">Click a file to load its diff.</p>
			{:else}
				<p class="empty">No file selected.</p>
			{/if}
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
	:global(body) {
		margin: 0;
		background: #f5f7fb;
	}
	.page {
		max-width: 1680px;
		margin: 0 auto;
		padding: 20px 22px 28px;
		font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		color: #111827;
	}
	nav a,
	.button {
		color: #2563eb;
		text-decoration: none;
		font-weight: 650;
	}
	header {
		display: grid;
		gap: 8px;
		margin: 10px 0 14px;
	}
	header h1 {
		margin: 0;
		font-size: clamp(1.45rem, 2vw, 2rem);
		letter-spacing: -0.03em;
	}
	header code,
	.commit-facts code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}
	.eyebrow,
	.meta,
	.actions,
	.diff-header p,
	.file-stats,
	.commit-facts,
	.shortcut-hint {
		color: #667085;
		font-size: 0.83rem;
		font-weight: 650;
	}
	.eyebrow {
		margin: 0 0 3px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 0.69rem;
	}
	.meta,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-bottom: 2px;
	}
	.summary,
	.commit-rail,
	.file-pane,
	.diff-panel,
	.comments {
		border: 1px solid #d9e1ee;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
	}
	.summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 14px;
		margin: 14px 0;
		padding: 10px 12px;
		background: #f8fbff;
	}
	.summary div {
		display: flex;
		gap: 8px;
		align-items: baseline;
		flex-wrap: wrap;
	}
	kbd,
	.keyboard-pill,
	.count-pill {
		border: 1px solid #cbd5e1;
		border-bottom-width: 2px;
		border-radius: 6px;
		background: #fff;
		padding: 1px 6px;
		font: 700 0.75rem ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		color: #475467;
	}
	.review-workspace {
		display: grid;
		grid-template-columns: minmax(300px, 360px) minmax(300px, 440px) minmax(520px, 1fr);
		gap: 12px;
		align-items: stretch;
		min-height: 78vh;
	}
	.review-workspace.without-commits {
		grid-template-columns: minmax(320px, 440px) minmax(520px, 1fr);
	}
	.commit-rail,
	.file-pane,
	.diff-panel {
		min-height: 0;
		max-height: 82vh;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.file-pane {
		overflow: hidden;
	}
	.commit-rail:focus-visible {
		outline: 3px solid #bfdbfe;
		outline-offset: 2px;
	}
	.commit-rail,
	.commit-rail * {
		user-select: text;
	}
	.pane-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 13px 14px 10px;
		border-bottom: 1px solid #e4eaf3;
	}
	.pane-head h2 {
		margin: 0;
		font-size: 1rem;
		letter-spacing: -0.01em;
	}
	.pane-head.compact {
		align-items: center;
	}
	button,
	.button {
		border: 1px solid #cfd8e6;
		border-radius: 9px;
		background: #f8fafc;
		padding: 7px 10px;
		cursor: pointer;
		font: inherit;
		transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
	}
	button:hover {
		border-color: #9bb5d6;
		background: #f5f8fc;
	}
	button.active,
	button.primary {
		background: #1f6feb;
		border-color: #1f6feb;
		color: #fff;
	}
	.commit-list {
		overflow: auto;
		padding: 8px;
		display: grid;
		gap: 6px;
	}
	.commit-row {
		width: calc(100% - 16px);
		margin: 8px 8px 0;
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr);
		gap: 8px;
		text-align: left;
		border-color: transparent;
		background: transparent;
		box-shadow: none;
	}
	.commit-list .commit-row {
		width: 100%;
		margin: 0;
	}
	.commit-row.active {
		background: #eff6ff;
		border-color: transparent;
		color: #0f172a;
		box-shadow: inset 3px 0 0 #1f6feb;
	}
	.commit-dot {
		align-self: start;
		display: inline-grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		background: #eef2f7;
		color: #475467;
		font-size: 0.75rem;
		font-weight: 800;
	}
	.commit-row.active .commit-dot {
		background: #1f6feb;
		color: #fff;
	}
	.commit-main {
		min-width: 0;
		display: grid;
		gap: 4px;
	}
	.commit-subject,
	.commit-main strong {
		font-weight: 720;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.commit-facts,
	.file-stats,
	.badges {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.commit-message {
		margin: 4px 0 0;
		max-height: min(42vh, 26rem);
		overflow: auto;
		overscroll-behavior: contain;
		white-space: pre-wrap;
		word-break: break-word;
		background: transparent;
		color: #101828;
		border: 0;
		border-left: 2px solid #c7d2fe;
		border-radius: 0;
		padding: 2px 0 2px 10px;
		font-size: 0.78rem;
		line-height: 1.45;
	}
	.plus {
		color: #0f8a43;
		font-weight: 760;
	}
	.minus {
		color: #cf2e2e;
		font-weight: 760;
	}

	.file-toolbar {
		padding: 10px 12px;
		border-bottom: 1px solid #e4eaf3;
	}
	input {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 8px 10px;
		font: inherit;
	}
	.filters,
	.diff-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-top: 9px;
	}
	.filters button {
		padding: 4px 8px;
		font-size: 0.8rem;
	}
	.file-list {
		overflow: auto;
		list-style: none;
		padding: 8px;
		margin: 0;
		display: grid;
		gap: 6px;
	}
	.file-list li button {
		width: 100%;
		text-align: left;
		background: #fff;
		padding: 9px;
	}
	.file-list li.selected button {
		border-color: #1f6feb;
		background: #f7fbff;
		box-shadow: inset 3px 0 0 #1f6feb;
	}
	.file-list li.reviewed {
		opacity: 0.68;
	}
	.file-path {
		display: block;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.8rem;
		line-height: 1.35;
		word-break: break-word;
	}
	.file-stats,
	.badges {
		margin-top: 5px;
	}
	em {
		border-radius: 999px;
		background: #eef2f7;
		color: #475467;
		padding: 2px 7px;
		font-style: normal;
		font-size: 0.73rem;
		font-weight: 760;
	}
	em.reviewed-badge {
		background: #dcfce7;
		color: #166534;
	}
	.diff-header {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		background: #fff;
		border-bottom: 1px solid #e4eaf3;
		padding: 13px 14px 10px;
	}
	.diff-header h2 {
		margin: 0 0 4px;
		font-size: 1rem;
		word-break: break-all;
	}
	.virtual-diff {
		flex: 1;
		min-height: 0;
		overflow: auto;
		background: #0b1020;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 12px;
		line-height: 20px;
	}
	.diff-line {
		display: grid;
		grid-template-columns: 64px max-content;
		white-space: pre;
		color: #d9e6ff;
	}
	.diff-line code {
		padding-right: 24px;
	}
	.line-no {
		position: sticky;
		left: 0;
		background: #111827;
		color: #94a3b8;
		padding-right: 10px;
		text-align: right;
		user-select: none;
	}
	.added code {
		color: #86efac;
	}
	.deleted code {
		color: #fca5a5;
	}
	.header code {
		color: #93c5fd;
		font-weight: 700;
	}
	.collapsed,
	.empty,
	.loading,
	.error {
		margin: 14px;
		border-radius: 10px;
		padding: 18px;
		background: #f8fafc;
	}
	.error {
		background: #fef2f2;
		color: #b91c1c;
	}
	.comments {
		margin-top: 16px;
		padding: 14px;
	}
	pre:not(.commit-message) {
		overflow: auto;
		padding: 12px;
		border-radius: 8px;
		background: #0f172a;
		color: #dbeafe;
	}
	article {
		border-top: 1px solid #e2e8f0;
		padding: 12px 0;
	}
	@media (max-width: 1200px) {
		.review-workspace,
		.review-workspace.without-commits {
			grid-template-columns: 1fr;
		}
		.commit-rail,
		.file-pane,
		.diff-panel {
			max-height: none;
		}
		.virtual-diff {
			height: 70vh;
			flex: none;
		}
	}
</style>
