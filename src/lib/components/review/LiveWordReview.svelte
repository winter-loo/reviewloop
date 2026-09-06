<script lang="ts">
	import { onMount, tick } from 'svelte';

	interface Props {
		data: {
			kind: 'word';
			token: string;
			filename: string;
			size: number;
			updatedAt: string;
			src: string;
		};
	}

	let { data }: Props = $props();

	type Point = { x: number; y: number };

	type Stroke = {
		color: string;
		size: number;
		points: Point[];
	};

	type TextAnnotation = {
		id: string;
		type: 'text';
		selectedText: string;
		body: string;
		createdAt: string;
	};

	type BrushAnnotation = {
		id: string;
		type: 'brush';
		strokes: Stroke[];
		badgePosition: Point;
		body: string;
		createdAt: string;
	};

	type WordAnnotation = TextAnnotation | BrushAnnotation;

	const BRUSH_COLORS = [
		{ name: '红色', value: '#ef4444' },
		{ name: '橙黄', value: '#f59e0b' },
		{ name: '蓝色', value: '#3b82f6' },
		{ name: '绿色', value: '#10b981' },
		{ name: '紫色', value: '#a855f7' },
		{ name: '荧光黄', value: '#eab308' }
	];

	const BRUSH_SIZES = [
		{ name: '细', value: 3 },
		{ name: '中', value: 6 },
		{ name: '粗', value: 12 }
	];

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);
	let docContainer = $state<HTMLDivElement | null>(null);
	let scrollContainer = $state<HTMLElement | null>(null);
	let drawingCanvas = $state<HTMLCanvasElement | null>(null);

	// Zoom state
	let zoom = $state(1);

	// Annotations state
	let annotations = $state<WordAnnotation[]>([]);
	let totalAnnotationCount = $derived(annotations.length);
	let brushAnns = $derived(annotations.filter((a): a is BrushAnnotation => a.type === 'brush'));
	let selectedAnnotationId = $state<string | null>(null);
	let showListModal = $state(false);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	// Text selection annotation state
	let textSelectionCandidate = $state<{ selectedText: string; range: Range } | null>(null);
	let textDraft = $state<{ selectedText: string } | null>(null);
	let textDraftBody = $state('');
	let textComposerTextarea = $state<HTMLTextAreaElement | null>(null);

	// Brush annotation state
	let brushMode = $state(false);
	let brushColor = $state('#ef4444');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);
	let brushDraftComment = $state('');
	let brushComposerTextarea = $state<HTMLTextAreaElement | null>(null);

	const storageKey = $derived(`reviewloop:live-word:${data.token}`);

	onMount(() => {
		try {
			const saved = localStorage.getItem(storageKey);
			if (saved) {
				const parsed = JSON.parse(saved);
				annotations = Array.isArray(parsed) ? parsed : [];
			}
		} catch {
			annotations = [];
		}

		loadWordDocument();

		window.addEventListener('resize', handleResize);
		document.addEventListener('selectionchange', handleSelectionChange);

		return () => {
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('selectionchange', handleSelectionChange);
		};
	});

	async function loadWordDocument() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(data.src);
			if (!res.ok) throw new Error(`无法获取文件 (HTTP ${res.status})`);
			const buffer = await res.arrayBuffer();

			if (!docContainer) return;
			docContainer.innerHTML = '';

			const { renderAsync } = await import('docx-preview');
			await renderAsync(buffer, docContainer, undefined, {
				className: 'docx',
				inWrapper: true,
				breakPages: true,
				ignoreWidth: false,
				ignoreHeight: false,
				renderHeaders: true,
				renderFooters: true,
				renderFootnotes: true,
				renderEndnotes: true
			});

			isLoading = false;
			await tick();
			syncCanvasSize();
			renderHighlights();
		} catch (err: any) {
			console.error('Failed to load Word document:', err);
			isLoading = false;
			loadError = err?.message || '无法解析该 Word 文件，可能格式不兼容或损坏';
		}
	}

	function handleResize() {
		syncCanvasSize();
	}

	function syncCanvasSize() {
		if (!drawingCanvas || !docContainer) return;
		const rect = docContainer.getBoundingClientRect();
		const w = Math.max(docContainer.scrollWidth, Math.floor(rect.width));
		const h = Math.max(docContainer.scrollHeight, Math.floor(rect.height));

		const dpr = window.devicePixelRatio || 1;
		drawingCanvas.width = Math.floor(w * dpr);
		drawingCanvas.height = Math.floor(h * dpr);
		drawingCanvas.style.width = `${w}px`;
		drawingCanvas.style.height = `${h}px`;
		redrawDraftCanvas();
	}

	function handleSelectionChange() {
		if (brushMode || isLoading) return;
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
			textSelectionCandidate = null;
			return;
		}

		const range = selection.getRangeAt(0);
		if (!docContainer || !docContainer.contains(range.commonAncestorContainer)) {
			textSelectionCandidate = null;
			return;
		}

		const text = range.toString().trim();
		if (!text || text.length > 5000) {
			textSelectionCandidate = null;
			return;
		}

		textSelectionCandidate = {
			selectedText: text,
			range: range.cloneRange()
		};
	}

	function openTextComposer() {
		if (!textSelectionCandidate) return;
		textDraft = { selectedText: textSelectionCandidate.selectedText };
		textDraftBody = '';
		textSelectionCandidate = null;
		window.getSelection()?.removeAllRanges();
		tick().then(() => textComposerTextarea?.focus());
	}

	function cancelTextDraft() {
		textDraft = null;
		textDraftBody = '';
		textSelectionCandidate = null;
	}

	function saveTextDraft() {
		if (!textDraft || !textDraftBody.trim()) return;
		const annotation: TextAnnotation = {
			id: crypto.randomUUID(),
			type: 'text',
			selectedText: textDraft.selectedText,
			body: textDraftBody.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = annotation.id;
		cancelTextDraft();
		showNotice('已保存文字批注');
		renderHighlights();
	}

	function persistAnnotations(next: WordAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			showNotice('设备存储不足，批注仅临时保留');
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (selectedAnnotationId === id) selectedAnnotationId = null;
		showNotice('已删除批注');
		renderHighlights();
		redrawDraftCanvas();
	}

	function renderHighlights() {
		if (!document.getElementById('live-word-highlight-style')) {
			const style = document.createElement('style');
			style.id = 'live-word-highlight-style';
			style.textContent = '::highlight(live-word-annotations) { background: #fef08a; color: #18181b; }';
			document.head.append(style);
		}
		const registry = (CSS as any)?.highlights;
		const HighlightClass = (window as any)?.Highlight;
		if (!registry || !HighlightClass || !docContainer) return;
		registry.delete('live-word-annotations');

		const textAnns = annotations.filter((ann): ann is TextAnnotation => ann.type === 'text');
		if (textAnns.length === 0) return;

		const ranges: Range[] = [];
		const walker = document.createTreeWalker(docContainer, NodeFilter.SHOW_TEXT);
		const textNodes: { node: Text; start: number; end: number }[] = [];
		let fullText = '';

		for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
			const start = fullText.length;
			fullText += node.data;
			textNodes.push({ node, start, end: fullText.length });
		}

		for (const ann of textAnns) {
			let searchIndex = 0;
			while ((searchIndex = fullText.indexOf(ann.selectedText, searchIndex)) !== -1) {
				const matchEnd = searchIndex + ann.selectedText.length;
				const startNodeInfo = textNodes.find((tn) => searchIndex >= tn.start && searchIndex < tn.end);
				const endNodeInfo = textNodes.find((tn) => matchEnd > tn.start && matchEnd <= tn.end);

				if (startNodeInfo && endNodeInfo) {
					const range = document.createRange();
					range.setStart(startNodeInfo.node, searchIndex - startNodeInfo.start);
					range.setEnd(endNodeInfo.node, matchEnd - endNodeInfo.start);
					ranges.push(range);
					break;
				}
				searchIndex += 1;
			}
		}

		if (ranges.length > 0) {
			registry.set('live-word-annotations', new HighlightClass(...ranges));
		}
	}

	// Brush handling
	function getNormalizedPoint(e: PointerEvent): Point | null {
		const target = drawingCanvas;
		if (!target) return null;
		const rect = target.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const x = (e.clientX - rect.left) / rect.width;
		const y = (e.clientY - rect.top) / rect.height;
		return {
			x: Math.max(0, Math.min(1, x)),
			y: Math.max(0, Math.min(1, y))
		};
	}

	function handlePointerDown(e: PointerEvent) {
		if (!brushMode || e.button !== 0 || !drawingCanvas) return;
		const pt = getNormalizedPoint(e);
		if (!pt) return;

		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		isDrawing = true;
		currentStroke = {
			color: brushColor,
			size: brushSize,
			points: [pt]
		};

		redrawDraftCanvas();
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDrawing || !currentStroke || !drawingCanvas) return;
		const pt = getNormalizedPoint(e);
		if (!pt) return;
		currentStroke.points.push(pt);
		drawLatestStrokeSegment();
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDrawing) return;
		isDrawing = false;
		if (currentStroke && currentStroke.points.length > 0) {
			draftStrokes = [...draftStrokes, currentStroke];
			currentStroke = null;
			redrawDraftCanvas();
			tick().then(() => brushComposerTextarea?.focus());
		}
	}

	function handlePointerCancel() {
		if (!isDrawing) return;
		isDrawing = false;
		currentStroke = null;
		redrawDraftCanvas();
	}

	function drawLatestStrokeSegment() {
		if (!drawingCanvas || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		const baseW = drawingCanvas.offsetWidth;
		const baseH = drawingCanvas.offsetHeight;
		const pts = currentStroke.points;
		const p0 = pts[pts.length - 2];
		const p1 = pts[pts.length - 1];

		const dpr = window.devicePixelRatio || 1;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.strokeStyle = currentStroke.color;
		ctx.lineWidth = currentStroke.size;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		ctx.beginPath();
		ctx.moveTo(p0.x * baseW, p0.y * baseH);
		ctx.lineTo(p1.x * baseW, p1.y * baseH);
		ctx.stroke();
		ctx.restore();
	}

	function redrawDraftCanvas() {
		if (!drawingCanvas) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;
		const baseW = drawingCanvas.offsetWidth;
		const baseH = drawingCanvas.offsetHeight;
		const dpr = window.devicePixelRatio || 1;

		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, baseW, baseH);

		const all = currentStroke ? [...draftStrokes, currentStroke] : draftStrokes;
		for (const stroke of all) {
			if (stroke.points.length === 0) continue;
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = stroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';

			ctx.beginPath();
			ctx.moveTo(stroke.points[0].x * baseW, stroke.points[0].y * baseH);
			if (stroke.points.length === 1) {
				ctx.lineTo(stroke.points[0].x * baseW + 0.1, stroke.points[0].y * baseH + 0.1);
			} else {
				for (let i = 1; i < stroke.points.length; i++) {
					const p0 = stroke.points[i - 1];
					const p1 = stroke.points[i];
					const midX = ((p0.x + p1.x) / 2) * baseW;
					const midY = ((p0.y + p1.y) / 2) * baseH;
					ctx.quadraticCurveTo(p0.x * baseW, p0.y * baseH, midX, midY);
				}
				const last = stroke.points[stroke.points.length - 1];
				ctx.lineTo(last.x * baseW, last.y * baseH);
			}
			ctx.stroke();
		}
		ctx.restore();
	}

	function undoLastStroke() {
		if (draftStrokes.length > 0) {
			draftStrokes = draftStrokes.slice(0, -1);
			redrawDraftCanvas();
		}
	}

	function cancelBrushDraft() {
		draftStrokes = [];
		brushDraftComment = '';
		currentStroke = null;
		redrawDraftCanvas();
	}

	function saveBrushDraft() {
		if (draftStrokes.length === 0) return;
		const firstPoint = draftStrokes[0].points[0] ?? { x: 0.5, y: 0.5 };
		const annotation: BrushAnnotation = {
			id: crypto.randomUUID(),
			type: 'brush',
			strokes: draftStrokes,
			badgePosition: {
				x: Math.min(0.95, Math.max(0.05, firstPoint.x)),
				y: Math.min(0.95, Math.max(0.05, firstPoint.y))
			},
			body: brushDraftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = annotation.id;
		cancelBrushDraft();
		showNotice('已保存画笔标注');
	}

	function strokesToSvgPath(stroke: Stroke, baseW: number, baseH: number): string {
		if (!stroke.points || stroke.points.length === 0) return '';
		const pts = stroke.points;
		if (pts.length === 1) {
			const x = pts[0].x * baseW;
			const y = pts[0].y * baseH;
			return `M ${x} ${y} L ${x + 0.1} ${y + 0.1}`;
		}
		let path = `M ${pts[0].x * baseW} ${pts[0].y * baseH}`;
		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const midX = ((p0.x + p1.x) / 2) * baseW;
			const midY = ((p0.y + p1.y) / 2) * baseH;
			path += ` Q ${p0.x * baseW} ${p0.y * baseH} ${midX} ${midY}`;
		}
		const last = pts[pts.length - 1];
		path += ` L ${last.x * baseW} ${last.y * baseH}`;
		return path;
	}

	async function shareAnnotations() {
		const json = JSON.stringify(annotations, null, 2);
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(json);
			showNotice('批注 JSON 已复制到剪贴板');
			return;
		}
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${data.filename}.annotations.json`;
		anchor.click();
		URL.revokeObjectURL(url);
		showNotice('已下载批注文件');
	}

	function printDocument() {
		window.print();
	}
</script>

<svelte:head>
	<title>{data.filename} · Live Word Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="word-review-container">
	<!-- Top Toolbar -->
	<header class="word-header">
		<div class="file-meta">
			<span class="file-icon">📝</span>
			<div class="file-text">
				<strong class="file-name" title={data.filename}>{data.filename}</strong>
				<span class="file-sub">Word 文档 · {(data.size / 1024 / 1024).toFixed(2)} MB</span>
			</div>
		</div>

		<!-- Center Zoom & Mode Controls -->
		<div class="center-controls">
			<div class="zoom-pill">
				<button
					type="button"
					class="zoom-btn"
					onclick={() => (zoom = Math.max(0.5, +(zoom - 0.15).toFixed(2)))}
					disabled={zoom <= 0.5}
					title="缩小"
				>
					-
				</button>
				<span class="zoom-val">{Math.round(zoom * 100)}%</span>
				<button
					type="button"
					class="zoom-btn"
					onclick={() => (zoom = Math.min(2.0, +(zoom + 0.15).toFixed(2)))}
					disabled={zoom >= 2.0}
					title="放大"
				>
					+
				</button>
				<button type="button" class="zoom-reset" onclick={() => (zoom = 1)}>重置</button>
			</div>
		</div>

		<!-- Right Actions Toolbar -->
		<div class="toolbar-actions">
			{#if brushMode}
				<div class="brush-palette" role="toolbar" aria-label="画笔选项">
					<div class="color-picker">
						{#each BRUSH_COLORS as color}
							<button
								type="button"
								class="color-dot"
								class:selected={brushColor === color.value}
								style="background-color: {color.value}"
								title={color.name}
								onclick={() => (brushColor = color.value)}
							></button>
						{/each}
					</div>
					<div class="size-picker">
						{#each BRUSH_SIZES as sz}
							<button
								type="button"
								class="size-pill"
								class:selected={brushSize === sz.value}
								onclick={() => (brushSize = sz.value)}
							>
								{sz.name}
							</button>
						{/each}
					</div>
					<div class="action-divider"></div>
					<button
						type="button"
						class="mini-btn"
						onclick={undoLastStroke}
						disabled={draftStrokes.length === 0}
						title="撤销最后一笔"
					>
						↩
					</button>
					<button
						type="button"
						class="mini-btn"
						onclick={cancelBrushDraft}
						disabled={draftStrokes.length === 0}
						title="清空未保存画笔"
					>
						✕
					</button>
				</div>
			{/if}

			<button
				class="tool-btn"
				class:active={brushMode}
				type="button"
				onclick={() => {
					brushMode = !brushMode;
					if (!brushMode && draftStrokes.length > 0) cancelBrushDraft();
				}}
			>
				<span class="btn-icon">🎨</span>
				<span>{brushMode ? '退出画笔' : '画笔标注'}</span>
			</button>

			<button
				class="tool-btn badge-btn"
				type="button"
				onclick={() => (showListModal = true)}
				title="查看所有标注"
			>
				<span class="btn-icon">💬</span>
				<span>批注 ({totalAnnotationCount})</span>
			</button>

			<button
				class="tool-btn share-btn"
				type="button"
				onclick={shareAnnotations}
				disabled={annotations.length === 0}
				title="导出或复制批注 JSON"
			>
				<span class="btn-icon">📤</span>
				<span class="btn-label-desktop">导出批注</span>
			</button>

			<button
				class="tool-btn print-btn"
				type="button"
				onclick={printDocument}
				title="打印或另存为 PDF"
			>
				<span class="btn-icon">🖨️</span>
				<span class="btn-label-desktop">打印</span>
			</button>
		</div>
	</header>

	<!-- Scrollable Document Stage -->
	<main class="word-stage" bind:this={scrollContainer}>
		{#if isLoading}
			<div class="loading-overlay">
				<div class="spinner"></div>
				<p>正在解析 Word 文档排版与样式...</p>
			</div>
		{:else if loadError}
			<div class="error-overlay">
				<span class="error-icon">⚠️</span>
				<p>{loadError}</p>
				<button class="retry-btn" onclick={loadWordDocument}>重新加载</button>
			</div>
		{/if}

		<div
			class="word-document-wrapper"
			style="transform: scale({zoom}); transform-origin: top center;"
		>
			<!-- Docx-preview Output Container -->
			<div
				bind:this={docContainer}
				class="docx-render-container"
				class:brush-active={brushMode}
			></div>

			<!-- Saved Brush Annotations (SVG Overlay) -->
			{#if docContainer && brushAnns.length > 0}
				<svg
					class="word-annotations-svg"
					style="width: {docContainer.scrollWidth}px; height: {docContainer.scrollHeight}px;"
					viewBox="0 0 {docContainer.scrollWidth} {docContainer.scrollHeight}"
				>
					{#each brushAnns as ann, annIndex (ann.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<g
							class="annotation-group"
							class:selected={selectedAnnotationId === ann.id}
							role="button"
							tabindex="0"
							onclick={() => (selectedAnnotationId = ann.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter') selectedAnnotationId = ann.id;
							}}
						>
							{#each ann.strokes as stroke}
								<path
									d={strokesToSvgPath(stroke, docContainer.scrollWidth, docContainer.scrollHeight)}
									stroke={stroke.color}
									stroke-width={stroke.size}
									stroke-linecap="round"
									stroke-linejoin="round"
									fill="none"
									class="saved-stroke"
								/>
							{/each}

							<!-- Numbered Badge Marker -->
							<g
								class="badge-marker"
								transform="translate({ann.badgePosition.x * docContainer.scrollWidth}, {ann.badgePosition.y * docContainer.scrollHeight})"
							>
								<circle r="14" class="badge-bg" />
								<text y="4" text-anchor="middle" class="badge-number">{annIndex + 1}</text>
							</g>
						</g>
					{/each}
				</svg>
			{/if}

			<!-- Active Drawing Canvas -->
			{#if brushMode}
				<canvas
					bind:this={drawingCanvas}
					class="word-drawing-canvas"
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerCancel}
				></canvas>
			{/if}
		</div>

		<!-- Floating Text Selection "Add Comment" Pill -->
		{#if textSelectionCandidate && !textDraft}
			<div class="floating-selection-bar">
				<button type="button" class="btn-add-comment" onclick={openTextComposer}>
					➕ 添加批注 · “{textSelectionCandidate.selectedText.slice(0, 24)}{textSelectionCandidate.selectedText.length > 24 ? '…' : ''}”
				</button>
			</div>
		{/if}
	</main>

	<!-- Text Comment Composer Modal/Popup -->
	{#if textDraft}
		<div class="composer-popup">
			<div class="composer-header">
				<span class="composer-title">💬 添加文字批注</span>
				<button type="button" class="close-composer-btn" onclick={cancelTextDraft}>✕</button>
			</div>
			<blockquote class="composer-quote">“{textDraft.selectedText}”</blockquote>
			<textarea
				bind:this={textComposerTextarea}
				bind:value={textDraftBody}
				placeholder="写下针对该段内容的批注或修改建议..."
				rows="3"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						saveTextDraft();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						cancelTextDraft();
					}
				}}
			></textarea>
			<div class="composer-actions">
				<button type="button" class="btn-secondary" onclick={cancelTextDraft}>取消</button>
				<button
					type="button"
					class="btn-primary"
					disabled={!textDraftBody.trim()}
					onclick={saveTextDraft}
				>
					保存批注
				</button>
			</div>
		</div>
	{/if}

	<!-- Brush Draft Comment Composer -->
	{#if draftStrokes.length > 0}
		<div class="composer-popup">
			<div class="composer-header">
				<span class="composer-title">✏️ 保存画笔标注</span>
				<span class="composer-sub">已绘制 {draftStrokes.length} 笔</span>
			</div>
			<textarea
				bind:this={brushComposerTextarea}
				bind:value={brushDraftComment}
				placeholder="填写修改意见或批注内容（支持多行，留空直接保存）..."
				rows="3"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						saveBrushDraft();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						cancelBrushDraft();
					}
				}}
			></textarea>
			<div class="composer-actions">
				<button type="button" class="btn-secondary" onclick={cancelBrushDraft}>放弃</button>
				<button type="button" class="btn-primary" onclick={saveBrushDraft}>保存标注</button>
			</div>
		</div>
	{/if}

	<!-- Selected Annotation Detail Card -->
	{#if selectedAnnotationId}
		{@const selectedAnn = annotations.find((a) => a.id === selectedAnnotationId)}
		{#if selectedAnn}
			<div class="detail-card">
				<div class="detail-header">
					<div class="detail-title">
						<span class="detail-badge" class:brush-badge={selectedAnn.type === 'brush'}>
							{selectedAnn.type === 'text' ? '文字批注' : '画笔标注'}
						</span>
						<span class="detail-time">
							{new Date(selectedAnn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
						</span>
					</div>
					<button
						type="button"
						class="close-detail-btn"
						onclick={() => (selectedAnnotationId = null)}
					>
						✕
					</button>
				</div>
				{#if selectedAnn.type === 'text'}
					<blockquote class="detail-quote">“{selectedAnn.selectedText}”</blockquote>
				{/if}
				<p class="detail-body">
					{selectedAnn.body || '（无附注文字）'}
				</p>
				<div class="detail-footer">
					<button
						type="button"
						class="delete-ann-btn"
						onclick={() => deleteAnnotation(selectedAnn.id)}
					>
						删除此批注
					</button>
				</div>
			</div>
		{/if}
	{/if}

	<!-- All Annotations Modal -->
	{#if showListModal}
		<div class="modal-wrapper">
			<button
				class="modal-backdrop"
				type="button"
				aria-label="关闭标注列表"
				onclick={() => (showListModal = false)}
			></button>
			<div class="modal-content" role="dialog" aria-modal="true" aria-label="全部批注列表">
				<div class="modal-header">
					<h3>全部文档批注与标注 ({totalAnnotationCount})</h3>
					<button type="button" class="close-btn" onclick={() => (showListModal = false)}>✕</button>
				</div>
				<div class="modal-body">
					{#if annotations.length === 0}
						<div class="empty-list">
							<p>暂无批注。您可以直接在正文划选文字添加批注，或开启「画笔标注」圈画重点！</p>
						</div>
					{:else}
						<div class="ann-list">
							{#each annotations as ann, idx (ann.id)}
								<div class="ann-item">
									<div class="ann-item-header">
										<span class="ann-item-badge" class:brush-badge={ann.type === 'brush'}>
											#{idx + 1} {ann.type === 'text' ? '文字批注' : '画笔标注'}
										</span>
										<span class="ann-item-time">{new Date(ann.createdAt).toLocaleString()}</span>
									</div>
									{#if ann.type === 'text'}
										<blockquote class="ann-item-quote">“{ann.selectedText}”</blockquote>
									{/if}
									<p class="ann-item-text">{ann.body || '（画笔圈注，未填写文字）'}</p>
									<div class="ann-item-actions">
										<button
											type="button"
											class="btn-delete"
											onclick={() => deleteAnnotation(ann.id)}
										>
											删除
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Notice Toast -->
	{#if notice}
		<div class="notice-toast">{notice}</div>
	{/if}
</div>

<style>
	.word-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		background: #09090b;
		color: #f4f4f5;
		overflow: hidden;
		position: relative;
	}

	/* Header */
	.word-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 56px;
		padding: 0 16px;
		background: rgba(18, 18, 20, 0.95);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		backdrop-filter: blur(12px);
		z-index: 30;
		flex-shrink: 0;
	}

	.file-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.file-icon {
		font-size: 20px;
	}

	.file-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.file-name {
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 240px;
	}

	.file-sub {
		font-size: 11px;
		color: #a1a1aa;
	}

	/* Center Zoom */
	.center-controls {
		display: flex;
		align-items: center;
	}

	.zoom-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 999px;
		padding: 2px 8px;
		font-size: 12px;
	}

	.zoom-btn {
		background: transparent;
		border: none;
		color: #d4d4d8;
		font-size: 15px;
		cursor: pointer;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
	}

	.zoom-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
		color: #ffffff;
	}

	.zoom-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.zoom-val {
		min-width: 44px;
		text-align: center;
		font-weight: 600;
		color: #ffffff;
	}

	.zoom-reset {
		background: transparent;
		border: none;
		color: #3b82f6;
		font-size: 11px;
		cursor: pointer;
		margin-left: 4px;
	}

	/* Right Actions */
	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.brush-palette {
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		padding: 3px 8px;
		border-radius: 8px;
	}

	.color-picker {
		display: flex;
		gap: 5px;
	}

	.color-dot {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
		transition: transform 0.1s;
	}

	.color-dot.selected {
		border-color: #ffffff;
		transform: scale(1.25);
	}

	.size-picker {
		display: flex;
		gap: 3px;
	}

	.size-pill {
		background: transparent;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #a1a1aa;
		border-radius: 4px;
		padding: 1px 6px;
		font-size: 11px;
		cursor: pointer;
	}

	.size-pill.selected {
		background: rgba(255, 255, 255, 0.2);
		color: #ffffff;
		border-color: #ffffff;
	}

	.action-divider {
		width: 1px;
		height: 16px;
		background: rgba(255, 255, 255, 0.15);
	}

	.mini-btn {
		background: transparent;
		border: none;
		color: #d4d4d8;
		font-size: 13px;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
	}

	.mini-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
	}

	.mini-btn:disabled {
		opacity: 0.2;
		cursor: not-allowed;
	}

	.tool-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #e4e4e7;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.tool-btn:hover {
		background: rgba(255, 255, 255, 0.16);
		color: #ffffff;
	}

	.tool-btn.active {
		background: #2563eb;
		border-color: #3b82f6;
		color: #ffffff;
		box-shadow: 0 0 12px rgba(37, 99, 235, 0.4);
	}

	/* Main Stage */
	.word-stage {
		flex: 1;
		position: relative;
		overflow: auto;
		background: #18181b;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 30px 16px;
	}

	.word-document-wrapper {
		position: relative;
		max-width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		transition: transform 0.15s ease-out;
	}

	.docx-render-container {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.docx-render-container.brush-active {
		user-select: none;
	}

	/* docx-preview DOM style overrides */
	:global(.docx-wrapper) {
		background: transparent !important;
		padding: 0 !important;
		display: flex !important;
		flex-direction: column !important;
		align-items: center !important;
	}

	:global(section.docx) {
		background: #ffffff !important;
		color: #1a1a1a !important;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45) !important;
		border-radius: 3px !important;
		margin-bottom: 28px !important;
	}

	.word-annotations-svg {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 10;
	}

	.annotation-group {
		cursor: pointer;
		pointer-events: auto;
	}

	.saved-stroke {
		transition: stroke-width 0.15s;
	}

	.annotation-group.selected .saved-stroke {
		filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.8));
	}

	.badge-marker {
		cursor: pointer;
		transition: transform 0.15s ease;
	}

	.badge-marker:hover {
		transform: scale(1.2);
	}

	.badge-bg {
		fill: #ef4444;
		stroke: #ffffff;
		stroke-width: 2;
	}

	.badge-number {
		fill: #ffffff;
		font-size: 12px;
		font-weight: bold;
		font-family: sans-serif;
	}

	.word-drawing-canvas {
		position: absolute;
		top: 0;
		left: 0;
		cursor: crosshair;
		touch-action: none;
		z-index: 20;
	}

	/* Floating Selection Action */
	.floating-selection-bar {
		position: fixed;
		bottom: 30px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		animation: popUp 0.15s ease-out;
	}

	@keyframes popUp {
		from {
			opacity: 0;
			transform: translate(-50%, 10px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	.btn-add-comment {
		background: #2563eb;
		color: #ffffff;
		border: 1px solid #3b82f6;
		border-radius: 999px;
		padding: 8px 18px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		box-shadow: 0 10px 25px rgba(37, 99, 235, 0.5);
	}

	/* Composer Popup */
	.composer-popup {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		width: 90%;
		max-width: 440px;
		background: rgba(24, 24, 27, 0.96);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		padding: 14px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(16px);
		z-index: 50;
	}

	.composer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.composer-title {
		font-size: 13px;
		font-weight: 600;
	}

	.close-composer-btn {
		background: transparent;
		border: none;
		color: #a1a1aa;
		cursor: pointer;
		font-size: 14px;
	}

	.composer-quote {
		margin: 0 0 8px;
		padding: 6px 10px;
		background: rgba(255, 255, 255, 0.05);
		border-left: 3px solid #3b82f6;
		font-size: 12px;
		color: #d4d4d8;
		border-radius: 0 4px 4px 0;
	}

	.composer-popup textarea {
		width: 100%;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 6px;
		padding: 8px;
		color: #ffffff;
		font-size: 13px;
		resize: vertical;
		outline: none;
	}

	.composer-popup textarea:focus {
		border-color: #3b82f6;
	}

	.composer-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 10px;
	}

	.btn-secondary {
		padding: 6px 12px;
		background: rgba(255, 255, 255, 0.1);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 6px;
		color: #d4d4d8;
		font-size: 12px;
		cursor: pointer;
	}

	.btn-primary {
		padding: 6px 14px;
		background: #2563eb;
		border: none;
		border-radius: 6px;
		color: #ffffff;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Detail Card */
	.detail-card {
		position: fixed;
		top: 68px;
		right: 16px;
		width: 280px;
		background: rgba(24, 24, 27, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		padding: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(14px);
		z-index: 45;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.detail-badge {
		background: rgba(59, 130, 246, 0.2);
		color: #93c5fd;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.detail-badge.brush-badge {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
	}

	.detail-time {
		font-size: 11px;
		color: #a1a1aa;
		margin-left: 6px;
	}

	.close-detail-btn {
		background: transparent;
		border: none;
		color: #a1a1aa;
		cursor: pointer;
		font-size: 12px;
	}

	.detail-quote {
		margin: 0 0 8px;
		padding: 4px 8px;
		background: rgba(255, 255, 255, 0.05);
		border-left: 2px solid #3b82f6;
		font-size: 11px;
		color: #d4d4d8;
	}

	.detail-body {
		font-size: 13px;
		color: #f4f4f5;
		margin: 0 0 10px;
		white-space: pre-wrap;
	}

	.detail-footer {
		display: flex;
		justify-content: flex-end;
	}

	.delete-ann-btn {
		background: transparent;
		border: none;
		color: #ef4444;
		font-size: 11px;
		cursor: pointer;
		padding: 0;
	}

	/* Modal Backdrop & Content */
	.modal-wrapper {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 60;
	}

	.modal-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(4px);
		border: none;
		cursor: pointer;
		padding: 0;
		margin: 0;
		width: 100%;
		height: 100%;
	}

	.modal-content {
		position: relative;
		z-index: 1;
		width: 90%;
		max-width: 520px;
		max-height: 80vh;
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: 0 25px 50px rgba(0, 0, 0, 0.7);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 14px 18px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.modal-header h3 {
		margin: 0;
		font-size: 15px;
	}

	.close-btn {
		background: transparent;
		border: none;
		color: #a1a1aa;
		font-size: 16px;
		cursor: pointer;
	}

	.modal-body {
		padding: 16px;
		overflow-y: auto;
		max-height: calc(80vh - 60px);
	}

	.empty-list {
		text-align: center;
		color: #a1a1aa;
		padding: 30px 0;
		font-size: 13px;
	}

	.ann-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.ann-item {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 12px;
	}

	.ann-item-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}

	.ann-item-badge {
		font-size: 11px;
		font-weight: 600;
		color: #60a5fa;
	}

	.ann-item-badge.brush-badge {
		color: #f87171;
	}

	.ann-item-time {
		font-size: 11px;
		color: #71717a;
	}

	.ann-item-quote {
		margin: 0 0 6px;
		padding: 3px 8px;
		background: rgba(255, 255, 255, 0.05);
		border-left: 2px solid #3b82f6;
		font-size: 12px;
		color: #cbd5e1;
	}

	.ann-item-text {
		font-size: 13px;
		color: #e4e4e7;
		margin: 0 0 10px;
		white-space: pre-wrap;
	}

	.ann-item-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-delete {
		background: transparent;
		border: none;
		color: #ef4444;
		font-size: 11px;
		cursor: pointer;
	}

	/* Loading & Error */
	.loading-overlay,
	.error-overlay {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: #a1a1aa;
		font-size: 14px;
		padding: 40px 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(255, 255, 255, 0.1);
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-icon {
		font-size: 32px;
	}

	.retry-btn {
		background: #2563eb;
		border: none;
		color: #ffffff;
		padding: 6px 14px;
		border-radius: 6px;
		font-size: 13px;
		cursor: pointer;
	}

	/* Notice Toast */
	.notice-toast {
		position: fixed;
		bottom: 72px;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(24, 24, 27, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #ffffff;
		padding: 8px 18px;
		border-radius: 999px;
		font-size: 12px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
		z-index: 70;
		pointer-events: none;
	}

	@media (max-width: 640px) {
		.btn-label-desktop {
			display: none;
		}
		.file-name {
			max-width: 140px;
		}
	}

	/* Print styles */
	@media print {
		.word-header,
		.floating-selection-bar,
		.composer-popup,
		.detail-card,
		.modal-wrapper,
		.notice-toast,
		.word-drawing-canvas {
			display: none !important;
		}
		.word-review-container,
		.word-stage {
			background: #ffffff !important;
			color: #000000 !important;
			height: auto !important;
			overflow: visible !important;
			padding: 0 !important;
		}
		.word-document-wrapper {
			transform: none !important;
		}
		:global(section.docx) {
			box-shadow: none !important;
			margin: 0 !important;
			page-break-after: always;
		}
	}
</style>
