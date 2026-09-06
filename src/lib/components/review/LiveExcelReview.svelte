<script lang="ts">
	import { onMount, tick } from 'svelte';
	import * as XLSX from 'xlsx';

	interface Props {
		data: {
			kind: 'excel';
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

	type CellAnnotation = {
		id: string;
		type: 'cell';
		sheetName: string;
		cellRef: string;
		minR: number;
		maxR: number;
		minC: number;
		maxC: number;
		cellValue: string;
		body: string;
		createdAt: string;
	};

	type PaintAnnotation = {
		id: string;
		type: 'paint';
		sheetName: string;
		badgePosition: Point;
		strokes: Stroke[];
		body: string;
		createdAt: string;
	};

	type ExcelAnnotation = CellAnnotation | PaintAnnotation;

	type GridCell = {
		r: number;
		c: number;
		addr: string;
		value: any;
		formatted: string;
		formula?: string;
		type: string;
		rowspan: number;
		colspan: number;
		hiddenByMerge: boolean;
	};

	type SheetData = {
		name: string;
		rowCount: number;
		colCount: number;
		colHeaders: string[];
		rowHeaders: number[];
		rows: GridCell[][];
	};

	const BRUSH_COLORS = [
		{ name: '红色', value: '#ef4444' },
		{ name: '橙黄', value: '#f59e0b' },
		{ name: '蓝色', value: '#3b82f6' },
		{ name: '绿色', value: '#10b981' },
		{ name: '紫色', value: '#a855f7' },
		{ name: '墨黑', value: '#1e293b' }
	];

	const BRUSH_SIZES = [
		{ name: '细', value: 3 },
		{ name: '中', value: 6 },
		{ name: '粗', value: 12 }
	];

	let workbook = $state<XLSX.WorkBook | null>(null);
	let sheetNames = $state<string[]>([]);
	let activeSheetIndex = $state(0);
	let activeSheetName = $derived(sheetNames[activeSheetIndex] ?? '');
	let currentSheetData = $state<SheetData | null>(null);

	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	// Grid selection state
	let selStart = $state<{ r: number; c: number } | null>(null);
	let selEnd = $state<{ r: number; c: number } | null>(null);
	let isSelectingCells = $state(false);

	let selectedRange = $derived.by(() => {
		if (!selStart) return null;
		const end = selEnd ?? selStart;
		const minR = Math.min(selStart.r, end.r);
		const maxR = Math.max(selStart.r, end.r);
		const minC = Math.min(selStart.c, end.c);
		const maxC = Math.max(selStart.c, end.c);
		const isSingle = minR === maxR && minC === maxC;
		const startAddr = XLSX.utils.encode_cell({ r: minR, c: minC });
		const endAddr = XLSX.utils.encode_cell({ r: maxR, c: maxC });
		const ref = isSingle ? startAddr : `${startAddr}:${endAddr}`;
		return { minR, maxR, minC, maxC, isSingle, ref };
	});

	// Active cell in formula bar
	let activeCell = $derived.by(() => {
		if (!currentSheetData || !selStart) return null;
		const row = currentSheetData.rows[selStart.r];
		if (!row) return null;
		return row[selStart.c] ?? null;
	});

	// Numeric stats for selected range
	let selectionStats = $derived.by(() => {
		if (!currentSheetData || !selectedRange || selectedRange.isSingle) return null;
		let count = 0;
		let numCount = 0;
		let sum = 0;
		for (let r = selectedRange.minR; r <= selectedRange.maxR; r++) {
			const row = currentSheetData.rows[r];
			if (!row) continue;
			for (let c = selectedRange.minC; c <= selectedRange.maxC; c++) {
				const cell = row[c];
				if (!cell || cell.hiddenByMerge) continue;
				count++;
				if (typeof cell.value === 'number') {
					numCount++;
					sum += cell.value;
				}
			}
		}
		if (count <= 1) return null;
		return {
			count,
			numCount,
			sum: numCount > 0 ? sum : null,
			avg: numCount > 0 ? (sum / numCount) : null
		};
	});

	// Annotations state
	let annotations = $state<ExcelAnnotation[]>([]);
	const storageKey = $derived(`reviewloop:live-excel:${data.token}`);

	let currentSheetAnnotations = $derived(
		annotations.filter((ann) => ann.sheetName === activeSheetName)
	);
	let currentSheetCellAnnotations = $derived(
		currentSheetAnnotations.filter((ann): ann is CellAnnotation => ann.type === 'cell')
	);
	let currentSheetPaintAnnotations = $derived(
		currentSheetAnnotations.filter((ann): ann is PaintAnnotation => ann.type === 'paint')
	);
	let totalAnnotationCount = $derived(annotations.length);

	// Cell annotations map for O(1) cell lookup
	let cellAnnotationsMap = $derived.by(() => {
		const map = new Map<string, CellAnnotation[]>();
		for (const ann of currentSheetCellAnnotations) {
			for (let r = ann.minR; r <= ann.maxR; r++) {
				for (let c = ann.minC; c <= ann.maxC; c++) {
					const addr = XLSX.utils.encode_cell({ r, c });
					const list = map.get(addr) ?? [];
					list.push(ann);
					map.set(addr, list);
				}
			}
		}
		return map;
	});

	// Brush mode & drawing
	let brushMode = $state(false);
	let brushColor = $state('#ef4444');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);

	// Modals & Popovers
	let showCellComposer = $state(false);
	let cellDraftBody = $state('');
	let showBrushComposer = $state(false);
	let brushDraftComment = $state('');

	let activeDetailAnnotation = $state<ExcelAnnotation | null>(null);
	let showListModal = $state(false);
	let filterCurrentSheetOnly = $state(false);

	// Zoom
	let zoom = $state(1);

	// Notice
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	// DOM references
	let tableContainer = $state<HTMLDivElement | null>(null);
	let drawingCanvas = $state<HTMLCanvasElement | null>(null);
	let cellComposerTextarea = $state<HTMLTextAreaElement | null>(null);
	let brushComposerTextarea = $state<HTMLTextAreaElement | null>(null);

	let contentWidth = $state(1000);
	let contentHeight = $state(800);
	let gridTable = $state<HTMLTableElement | null>(null);

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

		loadWorkbook();

		window.addEventListener('resize', handleResize);
		window.addEventListener('pointerup', handleWindowPointerUp);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('pointerup', handleWindowPointerUp);
		};
	});

	async function loadWorkbook() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(data.src);
			if (!res.ok) throw new Error(`无法获取表格文件 (HTTP ${res.status})`);
			const buffer = await res.arrayBuffer();

			const wb = XLSX.read(buffer, {
				type: 'array',
				cellDates: true,
				cellStyles: true,
				cellFormula: true
			});

			if (!wb || !wb.SheetNames || wb.SheetNames.length === 0) {
				throw new Error('工作簿中未找到有效的工作表');
			}

			workbook = wb;
			sheetNames = wb.SheetNames;
			activeSheetIndex = 0;
			loadSheet(sheetNames[0]);
			isLoading = false;
		} catch (err: any) {
			console.error('Failed to load Excel workbook:', err);
			isLoading = false;
			loadError = err?.message || '无法解析该表格文件，可能格式不兼容或损坏';
		}
	}

	function loadSheet(sheetName: string) {
		if (!workbook) return;
		const ws = workbook.Sheets[sheetName];
		if (!ws) return;

		const ref = ws['!ref'] || 'A1:A1';
		const range = XLSX.utils.decode_range(ref);

		// Limit rows / cols for performance if monstrous
		const maxRow = Math.min(range.e.r, 800);
		const maxCol = Math.min(range.e.c, 60);

		// Build merges map
		const mergesMap = new Map<string, { isOrigin: boolean; rowspan: number; colspan: number }>();
		if (ws['!merges']) {
			for (const m of ws['!merges']) {
				const origin = XLSX.utils.encode_cell(m.s);
				const rowspan = m.e.r - m.s.r + 1;
				const colspan = m.e.c - m.s.c + 1;
				mergesMap.set(origin, { isOrigin: true, rowspan, colspan });
				for (let r = m.s.r; r <= m.e.r; r++) {
					for (let c = m.s.c; c <= m.e.c; c++) {
						if (r !== m.s.r || c !== m.s.c) {
							mergesMap.set(XLSX.utils.encode_cell({ r, c }), { isOrigin: false, rowspan: 0, colspan: 0 });
						}
					}
				}
			}
		}

		// Col headers
		const colHeaders: string[] = [];
		for (let c = range.s.c; c <= maxCol; c++) {
			colHeaders.push(XLSX.utils.encode_col(c));
		}

		// Row headers & cells
		const rowHeaders: number[] = [];
		const rows: GridCell[][] = [];

		for (let r = range.s.r; r <= maxRow; r++) {
			rowHeaders.push(r + 1);
			const rowCells: GridCell[] = [];
			for (let c = range.s.c; c <= maxCol; c++) {
				const addr = XLSX.utils.encode_cell({ r, c });
				const cell = ws[addr];
				const mergeInfo = mergesMap.get(addr);

				let formatted = '';
				let rawValue: any = '';
				let cellType = 's';
				let formula: string | undefined;

				if (cell) {
					rawValue = cell.v ?? '';
					cellType = cell.t || 's';
					if (cell.w !== undefined) {
						formatted = cell.w;
					} else if (cell.v instanceof Date) {
						formatted = cell.v.toLocaleDateString();
					} else if (cell.v !== undefined && cell.v !== null) {
						formatted = String(cell.v);
					}
					if (cell.f) {
						formula = `=${cell.f}`;
					}
				}

				rowCells.push({
					r,
					c,
					addr,
					value: rawValue,
					formatted,
					formula,
					type: cellType,
					rowspan: mergeInfo?.isOrigin ? mergeInfo.rowspan : 1,
					colspan: mergeInfo?.isOrigin ? mergeInfo.colspan : 1,
					hiddenByMerge: mergeInfo ? !mergeInfo.isOrigin : false
				});
			}
			rows.push(rowCells);
		}

		currentSheetData = {
			name: sheetName,
			rowCount: maxRow - range.s.r + 1,
			colCount: maxCol - range.s.c + 1,
			colHeaders,
			rowHeaders,
			rows
		};

		// Reset selection
		selStart = { r: 0, c: 0 };
		selEnd = { r: 0, c: 0 };

		tick().then(() => {
			syncCanvasDimensions();
		});
	}

	function switchSheet(name: string) {
		const idx = sheetNames.indexOf(name);
		if (idx !== -1) {
			activeSheetIndex = idx;
			loadSheet(name);
			if (brushMode) {
				draftStrokes = [];
				redrawDraftCanvas();
			}
		}
	}

	function handleResize() {
		syncCanvasDimensions();
	}

	// Re-measure whenever the rendered sheet or the zoom changes, so the canvas
	// and the saved-annotation SVG keep matching the grid they sit on top of.
	$effect(() => {
		if (!gridTable || !currentSheetData) return;
		void zoom;
		syncCanvasDimensions();
	});

	function syncCanvasDimensions() {
		// Measure the grid table itself. The two obvious alternatives are both
		// wrong: tableContainer is the scroll viewport (a different box, which
		// left the canvas overflowing the content by hundreds of px), and
		// .sheet-content-wrapper also contains the saved-annotation SVG that is
		// itself sized from contentHeight -- measuring it is circular, so the
		// value latches at its initial guess and can never shrink.
		if (!gridTable) return;
		const w = gridTable.offsetWidth;
		const h = gridTable.offsetHeight;
		if (w === 0 || h === 0) return;
		contentWidth = w;
		contentHeight = h;

		if (drawingCanvas) {
			drawingCanvas.width = contentWidth;
			drawingCanvas.height = contentHeight;
			// Pin the CSS box too. .sheet-content-wrapper stretches to fill the
			// scroll viewport, so the width:100% fallback would otherwise leave
			// the canvas wider than the grid it is meant to overlay.
			drawingCanvas.style.width = `${contentWidth}px`;
			drawingCanvas.style.height = `${contentHeight}px`;
			redrawDraftCanvas();
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function persistAnnotations(next: ExcelAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch (err) {
			console.warn('Failed to save Excel annotations to localStorage:', err);
		}
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (activeDetailAnnotation?.id === id) activeDetailAnnotation = null;
		showNotice('已删除批注');
		redrawDraftCanvas();
	}

	// Cell selection handlers
	function handleCellPointerDown(r: number, c: number, e: PointerEvent) {
		if (brushMode || e.button !== 0) return;
		isSelectingCells = true;
		selStart = { r, c };
		selEnd = { r, c };
	}

	function handleCellPointerEnter(r: number, c: number) {
		if (brushMode || !isSelectingCells) return;
		selEnd = { r, c };
	}

	function handleWindowPointerUp() {
		if (isSelectingCells) {
			isSelectingCells = false;
		}
	}

	function isCellSelected(r: number, c: number): boolean {
		if (!selectedRange) return false;
		return (
			r >= selectedRange.minR &&
			r <= selectedRange.maxR &&
			c >= selectedRange.minC &&
			c <= selectedRange.maxC
		);
	}

	function isCellActive(r: number, c: number): boolean {
		if (!selStart) return false;
		return selStart.r === r && selStart.c === c;
	}

	// Cell comment composer
	function openCellComposer() {
		if (!selectedRange || !activeCell) return;
		cellDraftBody = '';
		showCellComposer = true;
		tick().then(() => cellComposerTextarea?.focus());
	}

	function saveCellAnnotation() {
		if (!cellDraftBody.trim() || !selectedRange || !activeCell) return;

		const cellValueStr = activeCell.formatted || String(activeCell.value || '');
		const newAnn: CellAnnotation = {
			id: `cell-ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			type: 'cell',
			sheetName: activeSheetName,
			cellRef: selectedRange.ref,
			minR: selectedRange.minR,
			maxR: selectedRange.maxR,
			minC: selectedRange.minC,
			maxC: selectedRange.maxC,
			cellValue: cellValueStr,
			body: cellDraftBody.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, newAnn];
		persistAnnotations(next);
		showCellComposer = false;
		cellDraftBody = '';
		activeDetailAnnotation = newAnn;
		showNotice(`已保存单元格 [${newAnn.cellRef}] 批注`);
	}

	// Brush Drawing Logic
	function toggleBrushMode() {
		brushMode = !brushMode;
		if (brushMode) {
			syncCanvasDimensions();
			showNotice('已开启画笔标注，可在表格任意区域涂鸦');
		} else {
			draftStrokes = [];
			redrawDraftCanvas();
		}
	}

	function getPointerPos(e: PointerEvent): Point | null {
		if (!tableContainer) return null;
		const rect = tableContainer.getBoundingClientRect();
		// Account for container scroll
		const scrollLeft = tableContainer.scrollLeft;
		const scrollTop = tableContainer.scrollTop;
		const x = (e.clientX - rect.left + scrollLeft) / zoom;
		const y = (e.clientY - rect.top + scrollTop) / zoom;
		return { x, y };
	}

	function handleCanvasPointerDown(e: PointerEvent) {
		if (!brushMode || e.button !== 0 || !drawingCanvas) return;
		const pt = getPointerPos(e);
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

	function handleCanvasPointerMove(e: PointerEvent) {
		if (!isDrawing || !currentStroke || !drawingCanvas) return;
		const pt = getPointerPos(e);
		if (!pt) return;
		currentStroke.points.push(pt);
		drawLatestStrokeSegment();
	}

	function handleCanvasPointerUp(e: PointerEvent) {
		if (!isDrawing) return;
		isDrawing = false;
		if (currentStroke && currentStroke.points.length > 0) {
			draftStrokes = [...draftStrokes, currentStroke];
			currentStroke = null;
			redrawDraftCanvas();
		}
	}

	function drawLatestStrokeSegment() {
		if (!drawingCanvas || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		const pts = currentStroke.points;
		const p0 = pts[pts.length - 2];
		const p1 = pts[pts.length - 1];

		ctx.save();
		ctx.strokeStyle = currentStroke.color;
		ctx.lineWidth = currentStroke.size;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(p0.x, p0.y);
		ctx.lineTo(p1.x, p1.y);
		ctx.stroke();
		ctx.restore();
	}

	function redrawDraftCanvas() {
		if (!drawingCanvas) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

		// Draw draft strokes
		for (const stroke of draftStrokes) {
			if (!stroke.points || stroke.points.length === 0) continue;
			ctx.save();
			ctx.strokeStyle = stroke.color;
			ctx.lineWidth = stroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
			for (let i = 1; i < stroke.points.length; i++) {
				ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
			}
			ctx.stroke();
			ctx.restore();
		}

		// Draw currently active stroke
		if (currentStroke && currentStroke.points.length > 0) {
			ctx.save();
			ctx.strokeStyle = currentStroke.color;
			ctx.lineWidth = currentStroke.size;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.beginPath();
			ctx.moveTo(currentStroke.points[0].x, currentStroke.points[0].y);
			for (let i = 1; i < currentStroke.points.length; i++) {
				ctx.lineTo(currentStroke.points[i].x, currentStroke.points[i].y);
			}
			ctx.stroke();
			ctx.restore();
		}
	}

	function undoLastDraftStroke() {
		if (draftStrokes.length === 0) return;
		draftStrokes = draftStrokes.slice(0, -1);
		redrawDraftCanvas();
	}

	function clearDraftStrokes() {
		draftStrokes = [];
		redrawDraftCanvas();
	}

	function openBrushComposer() {
		if (draftStrokes.length === 0) return;
		brushDraftComment = '';
		showBrushComposer = true;
		tick().then(() => brushComposerTextarea?.focus());
	}

	function saveBrushAnnotation() {
		if (!brushDraftComment.trim() || draftStrokes.length === 0) return;

		// Determine badge position (first point of first stroke)
		const firstPt = draftStrokes[0].points[0] ?? { x: 50, y: 50 };

		const newAnn: PaintAnnotation = {
			id: `paint-ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			type: 'paint',
			sheetName: activeSheetName,
			badgePosition: { x: Math.round(firstPt.x), y: Math.round(firstPt.y) },
			strokes: [...draftStrokes],
			body: brushDraftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, newAnn];
		persistAnnotations(next);
		draftStrokes = [];
		showBrushComposer = false;
		brushDraftComment = '';
		redrawDraftCanvas();
		activeDetailAnnotation = newAnn;
		showNotice('已保存画笔标注');
	}

	function strokeToSvgPath(stroke: Stroke): string {
		if (!stroke.points || stroke.points.length === 0) return '';
		const pts = stroke.points;
		if (pts.length === 1) {
			return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.1} ${pts[0].y + 0.1}`;
		}
		let path = `M ${pts[0].x} ${pts[0].y}`;
		for (let i = 1; i < pts.length; i++) {
			const p0 = pts[i - 1];
			const p1 = pts[i];
			const midX = (p0.x + p1.x) / 2;
			const midY = (p0.y + p1.y) / 2;
			path += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
		}
		const last = pts[pts.length - 1];
		path += ` L ${last.x} ${last.y}`;
		return path;
	}

	// Zoom Controls
	function zoomIn() {
		zoom = Math.min(2.0, +(zoom + 0.1).toFixed(1));
		tick().then(syncCanvasDimensions);
	}

	function zoomOut() {
		zoom = Math.max(0.6, +(zoom - 0.1).toFixed(1));
		tick().then(syncCanvasDimensions);
	}

	function zoomReset() {
		zoom = 1;
		tick().then(syncCanvasDimensions);
	}

	// Jump to annotation location
	function jumpToAnnotation(ann: ExcelAnnotation) {
		showListModal = false;
		if (ann.sheetName !== activeSheetName) {
			switchSheet(ann.sheetName);
		}

		activeDetailAnnotation = ann;

		tick().then(() => {
			if (ann.type === 'cell') {
				selStart = { r: ann.minR, c: ann.minC };
				selEnd = { r: ann.maxR, c: ann.maxC };
				const el = document.getElementById(`cell-${ann.sheetName}-${ann.minR}-${ann.minC}`);
				el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
			} else {
				if (tableContainer) {
					tableContainer.scrollTo({
						left: Math.max(0, ann.badgePosition.x - 200),
						top: Math.max(0, ann.badgePosition.y - 200),
						behavior: 'smooth'
					});
				}
			}
		});
	}

	// Export annotations & active sheet CSV
	async function exportAnnotationsJson() {
		const json = JSON.stringify(annotations, null, 2);
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(json);
			showNotice('全部批注 JSON 已复制到剪贴板');
			return;
		}
		const blob = new Blob([json], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${data.filename}.annotations.json`;
		a.click();
		URL.revokeObjectURL(url);
		showNotice('已下载批注 JSON 文件');
	}

	function exportActiveSheetCsv() {
		if (!workbook || !activeSheetName) return;
		const ws = workbook.Sheets[activeSheetName];
		if (!ws) return;
		const csv = XLSX.utils.sheet_to_csv(ws);
		const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csv], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${activeSheetName}.csv`;
		a.click();
		URL.revokeObjectURL(url);
		showNotice(`已导出 ${activeSheetName}.csv`);
	}
</script>

<svelte:head>
	<title>{data.filename} · Live Excel Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="excel-review-container">
	<!-- Top Navigation Header -->
	<header class="excel-header">
		<div class="file-meta">
			<span class="file-icon">📊</span>
			<div class="file-text">
				<strong class="file-name" title={data.filename}>{data.filename}</strong>
				<span class="file-sub">
					{sheetNames.length} 个工作表 ·
					{#if currentSheetData}
						{currentSheetData.rowCount} 行 × {currentSheetData.colCount} 列 ·
					{/if}
					{(data.size / 1024 / 1024).toFixed(2)} MB
				</span>
			</div>
		</div>

		<div class="header-actions">
			<!-- Mode Toggle -->
			<div class="mode-toggles">
				<button
					type="button"
					class="toggle-btn"
					class:active={!brushMode}
					onclick={() => { if (brushMode) toggleBrushMode(); }}
					title="表格选择与单元格批注"
				>
					<span class="icon">⊞</span> 表格模式
				</button>
				<button
					type="button"
					class="toggle-btn"
					class:active={brushMode}
					onclick={toggleBrushMode}
					title="画笔自由涂鸦与标注"
				>
					<span class="icon">✎</span> 画笔标注
				</button>
			</div>

			<!-- Zoom Controls -->
			<div class="zoom-controls">
				<button type="button" onclick={zoomOut} title="缩小" disabled={zoom <= 0.6}>−</button>
				<button type="button" class="zoom-val" onclick={zoomReset} title="重置缩放">{Math.round(zoom * 100)}%</button>
				<button type="button" onclick={zoomIn} title="放大" disabled={zoom >= 2.0}>+</button>
			</div>

			<!-- Annotations Drawer Button -->
			<button
				type="button"
				class="ann-btn"
				class:has-ann={totalAnnotationCount > 0}
				onclick={() => { showListModal = true; }}
			>
				<span>批注清单</span>
				<span class="ann-badge">{totalAnnotationCount}</span>
			</button>
		</div>
	</header>

	<!-- Paintbrush Floating Toolbar -->
	{#if brushMode}
		<div class="brush-toolbar" role="toolbar" aria-label="画笔工具栏">
			<div class="color-picker">
				{#each BRUSH_COLORS as color}
					<button
						type="button"
						class="color-dot"
						class:active={brushColor === color.value}
						style:background-color={color.value}
						title={color.name}
						aria-label={color.name}
						onclick={() => (brushColor = color.value)}
					></button>
				{/each}
			</div>

			<div class="divider"></div>

			<div class="size-picker">
				{#each BRUSH_SIZES as size}
					<button
						type="button"
						class="size-dot"
						class:active={brushSize === size.value}
						title={`笔触: ${size.name}`}
						onclick={() => (brushSize = size.value)}
					>
						<span style:width="{size.value + 4}px" style:height="{size.value + 4}px"></span>
					</button>
				{/each}
			</div>

			<div class="divider"></div>

			<button
				type="button"
				class="tool-btn"
				disabled={draftStrokes.length === 0}
				onclick={undoLastDraftStroke}
				title="撤销上一笔"
			>
				↶ 撤销
			</button>

			<button
				type="button"
				class="tool-btn"
				disabled={draftStrokes.length === 0}
				onclick={clearDraftStrokes}
				title="清空当前草稿"
			>
				清空
			</button>

			{#if draftStrokes.length > 0}
				<button
					type="button"
					class="save-draft-btn"
					onclick={openBrushComposer}
				>
					保存批注 ({draftStrokes.length})
				</button>
			{/if}

			<button
				type="button"
				class="close-brush-btn"
				onclick={toggleBrushMode}
				title="完成画笔标注"
			>
				✕ 退出画笔
			</button>
		</div>
	{/if}

	<!-- Formula Bar & Status Strip -->
	<div class="formula-bar">
		<div class="cell-addr-box">
			{selectedRange ? selectedRange.ref : (currentSheetData?.colHeaders[0] ? `${currentSheetData.colHeaders[0]}1` : '')}
		</div>
		<div class="formula-fx-label">fx</div>
		<div class="formula-input" title="单元格公式或取值">
			{#if activeCell}
				{#if activeCell.formula}
					<span class="formula-val">{activeCell.formula}</span>
				{:else}
					<span class="cell-val">{activeCell.formatted}</span>
				{/if}
			{:else}
				<span class="empty-hint">点击表格单元格以查看或添加批注</span>
			{/if}
		</div>

		{#if selectionStats}
			<div class="stats-strip">
				<span>计数: <b>{selectionStats.count}</b></span>
				{#if selectionStats.sum !== null}
					<span>求和: <b>{selectionStats.sum.toLocaleString()}</b></span>
					<span>平均: <b>{selectionStats.avg?.toFixed(2)}</b></span>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			class="add-cell-comment-btn"
			disabled={!selectedRange}
			onclick={openCellComposer}
		>
			➕ 批注该区域
		</button>
	</div>

	<!-- Main Workspace Area -->
	<main class="excel-stage">
		{#if isLoading}
			<div class="loading-state">
				<div class="spinner"></div>
				<p>正在解析 Excel 电子表格…</p>
			</div>
		{:else if loadError}
			<div class="error-state">
				<div class="error-icon">⚠️</div>
				<p>{loadError}</p>
				<button type="button" onclick={loadWorkbook}>重新加载</button>
			</div>
		{:else if currentSheetData}
			<div
				class="table-scroll-container"
				bind:this={tableContainer}
				onscroll={syncCanvasDimensions}
			>
				<div
					class="sheet-content-wrapper"
					style:zoom="{zoom}"
				>
					<!-- The Spreadsheet Grid Table -->
					<table class="excel-table" bind:this={gridTable}>
						<thead>
							<tr>
								<th class="corner-header"></th>
								{#each currentSheetData.colHeaders as col}
									<th class="col-header">{col}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each currentSheetData.rows as row, rIdx}
								<tr>
									<th class="row-header">{currentSheetData.rowHeaders[rIdx]}</th>
									{#each row as cell, cIdx}
										{#if !cell.hiddenByMerge}
											{@const hasComments = cellAnnotationsMap.has(cell.addr)}
											<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
											<td
												id="cell-{currentSheetData.name}-{rIdx}-{cIdx}"
												rowspan={cell.rowspan}
												colspan={cell.colspan}
												class="grid-cell"
												class:cell-selected={isCellSelected(rIdx, cIdx)}
												class:cell-active={isCellActive(rIdx, cIdx)}
												class:has-comment={hasComments}
												class:type-number={cell.type === 'n'}
												class:type-boolean={cell.type === 'b'}
												onpointerdown={(e) => handleCellPointerDown(rIdx, cIdx, e)}
												onpointerenter={() => handleCellPointerEnter(rIdx, cIdx)}
												onclick={() => {
													if (hasComments) {
														const anns = cellAnnotationsMap.get(cell.addr);
														if (anns && anns.length > 0) {
															activeDetailAnnotation = anns[0];
														}
													}
												}}
											>
												{#if hasComments}
													<span class="comment-marker-triangle" title="该单元格有批注"></span>
												{/if}
												<span class="cell-text">{cell.formatted}</span>
											</td>
										{/if}
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>

					<!-- Saved Paint Annotations SVG Layer -->
					<svg
						class="saved-svg-layer"
						style:width="{contentWidth}px"
						style:height="{contentHeight}px"
					>
						{#each currentSheetPaintAnnotations as ann, idx}
							<g class="paint-annotation-group" class:active={activeDetailAnnotation?.id === ann.id}>
								{#each ann.strokes as stroke}
									<path
										d={strokeToSvgPath(stroke)}
										stroke={stroke.color}
										stroke-width={stroke.size}
										stroke-linecap="round"
										stroke-linejoin="round"
										fill="none"
									/>
								{/each}

								<!-- Annotation Pin Badge -->
								<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
								<g
									class="badge-marker"
									role="button"
									tabindex="0"
									transform="translate({ann.badgePosition.x}, {ann.badgePosition.y})"
									onclick={() => (activeDetailAnnotation = ann)}
								>
									<circle r="14" fill="#ef4444" stroke="#ffffff" stroke-width="2" />
									<text
										y="4.5"
										text-anchor="middle"
										fill="#ffffff"
										font-size="11"
										font-weight="bold"
									>
										{idx + 1}
									</text>
								</g>
							</g>
						{/each}
					</svg>

					<!-- Paintbrush Active Drawing Canvas Layer -->
					<canvas
						bind:this={drawingCanvas}
						class="drawing-canvas-layer"
						class:active={brushMode}
						onpointerdown={handleCanvasPointerDown}
						onpointermove={handleCanvasPointerMove}
						onpointerup={handleCanvasPointerUp}
						onpointercancel={handleCanvasPointerUp}
					></canvas>
				</div>
			</div>
		{/if}
	</main>

	<!-- Sheet Tabs Bar (Excel Bottom Strip) -->
	<footer class="excel-footer">
		<div class="sheet-tabs" role="tablist" aria-label="工作表标签">
			{#each sheetNames as name, idx}
				{@const annCount = annotations.filter((a) => a.sheetName === name).length}
				<button
					type="button"
					role="tab"
					aria-selected={activeSheetIndex === idx}
					class="sheet-tab"
					class:active={activeSheetIndex === idx}
					onclick={() => switchSheet(name)}
				>
					<span class="sheet-name">{name}</span>
					{#if annCount > 0}
						<span class="tab-ann-dot" title="{annCount} 条批注">{annCount}</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="footer-actions">
			<button type="button" class="footer-btn" onclick={exportActiveSheetCsv} title="导出当前表为 CSV">
				导出当前表 CSV
			</button>
			<button type="button" class="footer-btn" onclick={exportAnnotationsJson} title="导出全部批注 JSON">
				导出批注 JSON
			</button>
		</div>
	</footer>

	<!-- Notice Toast -->
	{#if notice}
		<div class="notice-toast" role="status">
			{notice}
		</div>
	{/if}

	<!-- Cell Annotation Composer Dialog -->
	{#if showCellComposer && selectedRange && activeCell}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => (showCellComposer = false)}>
			<div class="composer-modal" role="dialog" aria-modal="true" aria-label="添加单元格批注" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="composer-header">
					<h3>添加单元格批注</h3>
					<button type="button" class="close-x-btn" onclick={() => (showCellComposer = false)}>✕</button>
				</div>

				<div class="cell-context-box">
					<div class="ctx-tag">工作表: <b>{activeSheetName}</b> · 区域: <b>{selectedRange.ref}</b></div>
					<div class="ctx-val">
						当前值: <code>{activeCell.formatted || '(空)'}</code>
						{#if activeCell.formula}
							<span class="ctx-formula">公式: {activeCell.formula}</span>
						{/if}
					</div>
				</div>

				<textarea
					bind:this={cellComposerTextarea}
					bind:value={cellDraftBody}
					rows="4"
					placeholder="输入针对该单元格或区域的评审意见、修改建议…"
				></textarea>

				<div class="composer-footer">
					<button type="button" class="btn-secondary" onclick={() => (showCellComposer = false)}>取消</button>
					<button
						type="button"
						class="btn-primary"
						disabled={!cellDraftBody.trim()}
						onclick={saveCellAnnotation}
					>
						保存批注
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Paint Annotation Composer Dialog -->
	{#if showBrushComposer}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => (showBrushComposer = false)}>
			<div class="composer-modal" role="dialog" aria-modal="true" aria-label="保存画笔标注" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="composer-header">
					<h3>保存画笔标注</h3>
					<button type="button" class="close-x-btn" onclick={() => (showBrushComposer = false)}>✕</button>
				</div>

				<div class="cell-context-box">
					<div class="ctx-tag">工作表: <b>{activeSheetName}</b> · 已绘制 <b>{draftStrokes.length}</b> 笔涂鸦</div>
				</div>

				<textarea
					bind:this={brushComposerTextarea}
					bind:value={brushDraftComment}
					rows="4"
					placeholder="写下关于这处画笔涂鸦的评审意见…"
				></textarea>

				<div class="composer-footer">
					<button type="button" class="btn-secondary" onclick={() => (showBrushComposer = false)}>取消</button>
					<button
						type="button"
						class="btn-primary"
						disabled={!brushDraftComment.trim()}
						onclick={saveBrushAnnotation}
					>
						保存并固定到图层
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Annotation Detail Popover / Card -->
	{#if activeDetailAnnotation}
		{@const detail = activeDetailAnnotation}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => (activeDetailAnnotation = null)}>
			<div class="detail-card-modal" role="dialog" aria-modal="true" aria-label="批注详情" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="detail-header">
					<div class="detail-badge-title">
						{#if detail.type === 'cell'}
							<span class="tag-cell">单元格批注</span>
							<strong>[{detail.sheetName}] {detail.cellRef}</strong>
						{:else}
							<span class="tag-paint">画笔标注</span>
							<strong>[{detail.sheetName}] 自由涂鸦</strong>
						{/if}
					</div>
					<button type="button" class="close-x-btn" onclick={() => (activeDetailAnnotation = null)}>✕</button>
				</div>

				{#if detail.type === 'cell' && detail.cellValue}
					<div class="detail-quote">
						<span>单元格取值:</span>
						<code>{detail.cellValue}</code>
					</div>
				{/if}

				<div class="detail-body">
					{detail.body}
				</div>

				<div class="detail-meta">
					<span>创建时间: {new Date(detail.createdAt).toLocaleString()}</span>
				</div>

				<div class="detail-actions">
					<button
						type="button"
						class="btn-danger"
						onclick={() => deleteAnnotation(detail.id)}
					>
						删除批注
					</button>
					<button
						type="button"
						class="btn-primary"
						onclick={() => (activeDetailAnnotation = null)}
					>
						关闭
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- All Annotations Drawer -->
	{#if showListModal}
		{@const displayedList = filterCurrentSheetOnly ? currentSheetAnnotations : annotations}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="modal-backdrop" onclick={() => (showListModal = false)}>
			<div class="drawer-panel" role="dialog" aria-modal="true" aria-label="表格评审批注清单" tabindex="-1" onclick={(e) => e.stopPropagation()}>
				<div class="drawer-header">
					<h3>表格评审批注 ({totalAnnotationCount})</h3>
					<button type="button" class="close-x-btn" onclick={() => (showListModal = false)}>✕</button>
				</div>

				<div class="drawer-filter-bar">
					<label class="filter-toggle">
						<input type="checkbox" bind:checked={filterCurrentSheetOnly} />
						<span>仅看当前工作表 ({activeSheetName})</span>
					</label>
				</div>

				<div class="drawer-list">
					{#if displayedList.length === 0}
						<div class="empty-list-hint">
							<p>暂无批注记录</p>
							<span>可点击表格单元格添加批注，或切换到画笔标注进行涂鸦。</span>
						</div>
					{:else}
						{#each displayedList as item (item.id)}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div
								class="drawer-card"
								class:active={activeDetailAnnotation?.id === item.id}
								onclick={() => jumpToAnnotation(item)}
							>
								<div class="card-head">
									<span class="card-type-tag" class:paint={item.type === 'paint'}>
										{item.type === 'cell' ? `单元格 ${item.cellRef}` : '画笔涂鸦'}
									</span>
									<span class="card-sheet-name">{item.sheetName}</span>
									<button
										type="button"
										class="card-del-btn"
										title="删除批注"
										onclick={(e) => {
											e.stopPropagation();
											deleteAnnotation(item.id);
										}}
									>
										✕
									</button>
								</div>

								{#if item.type === 'cell' && item.cellValue}
									<div class="card-cell-val">数值: {item.cellValue}</div>
								{/if}

								<p class="card-comment-text">{item.body}</p>

								<div class="card-footer">
									<span class="card-time">{new Date(item.createdAt).toLocaleTimeString()}</span>
									<span class="card-jump-link">跳转定位 ➔</span>
								</div>
							</div>
						{/each}
					{/if}
				</div>

				<div class="drawer-footer">
					<button type="button" class="footer-action-btn" onclick={exportAnnotationsJson}>
						复制/导出全部 JSON
					</button>
					<button type="button" class="footer-action-btn" onclick={exportActiveSheetCsv}>
						导出当前表 CSV
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(*) { box-sizing: border-box; }
	:global(body) { margin: 0; background: #f8fafc; color: #1e293b; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }

	.excel-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: #f1f5f9;
	}

	/* Top Header */
	.excel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 16px;
		background: #ffffff;
		border-bottom: 1px solid #e2e8f0;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
		z-index: 20;
		gap: 12px;
	}

	.file-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.file-icon {
		font-size: 24px;
		line-height: 1;
	}

	.file-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.file-name {
		font-size: 14px;
		font-weight: 700;
		color: #0f172a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 320px;
	}

	.file-sub {
		font-size: 12px;
		color: #64748b;
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.mode-toggles {
		display: flex;
		background: #f1f5f9;
		border-radius: 8px;
		padding: 3px;
		gap: 2px;
	}

	.toggle-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 0;
		background: transparent;
		color: #64748b;
		font-size: 13px;
		font-weight: 600;
		padding: 6px 12px;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.toggle-btn:hover {
		color: #0f172a;
	}

	.toggle-btn.active {
		background: #ffffff;
		color: #0f172a;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}

	.zoom-controls {
		display: flex;
		align-items: center;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		overflow: hidden;
	}

	.zoom-controls button {
		border: 0;
		background: transparent;
		color: #475569;
		padding: 6px 10px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.zoom-controls button:hover:not(:disabled) {
		background: #e2e8f0;
	}

	.zoom-controls button:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.zoom-val {
		min-width: 52px;
		text-align: center;
	}

	.ann-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid #e2e8f0;
		background: #ffffff;
		color: #334155;
		padding: 6px 14px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
	}

	.ann-btn:hover {
		border-color: #cbd5e1;
		background: #f8fafc;
	}

	.ann-btn.has-ann {
		border-color: #10b981;
		color: #065f46;
		background: #ecfdf5;
	}

	.ann-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #10b981;
		color: #ffffff;
		font-size: 11px;
		font-weight: 700;
		border-radius: 999px;
		min-width: 18px;
		height: 18px;
		padding: 0 5px;
	}

	/* Floating Brush Toolbar */
	.brush-toolbar {
		position: absolute;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 14px;
		background: #1e293b;
		color: #f8fafc;
		border-radius: 999px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
	}

	.color-picker {
		display: flex;
		gap: 6px;
	}

	.color-dot {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		transition: transform 0.1s;
		padding: 0;
	}

	.color-dot.active {
		transform: scale(1.2);
		border-color: #ffffff;
	}

	.divider {
		width: 1px;
		height: 18px;
		background: #475569;
	}

	.size-picker {
		display: flex;
		gap: 6px;
	}

	.size-dot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		padding: 0;
	}

	.size-dot span {
		background: #f8fafc;
		border-radius: 50%;
	}

	.size-dot.active {
		background: #334155;
		border-color: #64748b;
	}

	.tool-btn {
		border: 0;
		background: transparent;
		color: #cbd5e1;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
	}

	.tool-btn:hover:not(:disabled) {
		background: #334155;
		color: #ffffff;
	}

	.tool-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.save-draft-btn {
		border: 0;
		background: #2563eb;
		color: #ffffff;
		font-size: 12px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 999px;
		cursor: pointer;
	}

	.save-draft-btn:hover {
		background: #1d4ed8;
	}

	.close-brush-btn {
		border: 0;
		background: transparent;
		color: #94a3b8;
		font-size: 12px;
		font-weight: 600;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
	}

	.close-brush-btn:hover {
		color: #ffffff;
	}

	/* Formula Bar */
	.formula-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 16px;
		background: #ffffff;
		border-bottom: 1px solid #e2e8f0;
		font-size: 13px;
		z-index: 10;
	}

	.cell-addr-box {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-weight: 700;
		color: #1e293b;
		background: #f1f5f9;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #cbd5e1;
		min-width: 64px;
		text-align: center;
	}

	.formula-fx-label {
		font-style: italic;
		font-weight: 700;
		color: #64748b;
		font-family: serif;
		font-size: 15px;
	}

	.formula-input {
		flex: 1;
		padding: 4px 10px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 6px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #0f172a;
	}

	.formula-val {
		font-family: ui-monospace, monospace;
		color: #2563eb;
		font-weight: 600;
	}

	.empty-hint {
		color: #94a3b8;
	}

	.stats-strip {
		display: flex;
		gap: 12px;
		font-size: 12px;
		color: #475569;
		background: #f1f5f9;
		padding: 4px 10px;
		border-radius: 6px;
		white-space: nowrap;
	}

	.add-cell-comment-btn {
		border: 1px solid #2563eb;
		background: #eff6ff;
		color: #2563eb;
		font-size: 12px;
		font-weight: 700;
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.add-cell-comment-btn:hover:not(:disabled) {
		background: #2563eb;
		color: #ffffff;
	}

	.add-cell-comment-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Main Stage */
	.excel-stage {
		flex: 1;
		position: relative;
		overflow: hidden;
		background: #cbd5e1;
	}

	.loading-state, .error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 12px;
		color: #64748b;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid #cbd5e1;
		border-top-color: #2563eb;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.error-icon {
		font-size: 36px;
	}

	/* Table container with scrollbars */
	.table-scroll-container {
		width: 100%;
		height: 100%;
		overflow: auto;
		position: relative;
		background: #ffffff;
	}

	.sheet-content-wrapper {
		position: relative;
		min-width: max-content;
		min-height: max-content;
		transform-origin: top left;
	}

	/* Spreadsheet Grid Table */
	.excel-table {
		border-collapse: collapse;
		table-layout: fixed;
		user-select: none;
		background: #ffffff;
	}

	.corner-header {
		position: sticky;
		top: 0;
		left: 0;
		z-index: 15;
		width: 48px;
		min-width: 48px;
		height: 26px;
		background: #f1f5f9;
		border: 1px solid #cbd5e1;
	}

	.col-header {
		position: sticky;
		top: 0;
		z-index: 10;
		height: 26px;
		min-width: 90px;
		max-width: 240px;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		color: #475569;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		line-height: 26px;
	}

	.row-header {
		position: sticky;
		left: 0;
		z-index: 10;
		width: 48px;
		min-width: 48px;
		background: #f8fafc;
		border: 1px solid #cbd5e1;
		color: #475569;
		font-size: 11px;
		font-weight: 700;
		text-align: center;
		vertical-align: middle;
	}

	.grid-cell {
		position: relative;
		height: 24px;
		min-width: 90px;
		max-width: 280px;
		padding: 3px 8px;
		border: 1px solid #e2e8f0;
		color: #1e293b;
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
		cursor: cell;
	}

	.grid-cell.type-number {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.grid-cell.type-boolean {
		text-align: center;
		font-weight: 600;
	}

	.grid-cell.cell-selected {
		background: rgba(37, 99, 235, 0.12);
	}

	.grid-cell.cell-active {
		outline: 2px solid #2563eb;
		outline-offset: -2px;
		z-index: 2;
	}

	/* Classic Excel Red Comment Marker */
	.comment-marker-triangle {
		position: absolute;
		top: 0;
		right: 0;
		width: 0;
		height: 0;
		border-top: 7px solid #ef4444;
		border-left: 7px solid transparent;
		z-index: 4;
		cursor: pointer;
	}

	.grid-cell.has-comment {
		box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.2);
	}

	/* Saved Paint Annotations SVG Layer */
	.saved-svg-layer {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 16;
	}

	.badge-marker {
		cursor: pointer;
		pointer-events: auto;
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.25));
		transition: transform 0.1s;
	}

	.badge-marker:hover {
		transform: scale(1.15);
	}

	/* Drawing Canvas Layer */
	.drawing-canvas-layer {
		position: absolute;
		top: 0;
		left: 0;
		/* Fallback so the canvas never falls back to its intrinsic 300x150
		   before the JS sizing pass runs; syncCanvasDimensions() overrides. */
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 17;
		cursor: crosshair;
	}

	.drawing-canvas-layer.active {
		pointer-events: auto;
	}

	/* Footer & Sheet Tabs */
	.excel-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 4px 16px;
		background: #ffffff;
		border-top: 1px solid #cbd5e1;
		z-index: 20;
		gap: 12px;
		overflow-x: auto;
	}

	.sheet-tabs {
		display: flex;
		align-items: center;
		gap: 4px;
		overflow-x: auto;
	}

	.sheet-tab {
		display: flex;
		align-items: center;
		gap: 6px;
		border: 1px solid transparent;
		background: #f1f5f9;
		color: #475569;
		padding: 6px 14px;
		border-radius: 6px 6px 0 0;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: all 0.15s;
	}

	.sheet-tab:hover {
		background: #e2e8f0;
		color: #0f172a;
	}

	.sheet-tab.active {
		background: #ffffff;
		color: #2563eb;
		border-color: #cbd5e1 #cbd5e1 transparent #cbd5e1;
		box-shadow: 0 -2px 0 0 #2563eb inset;
		font-weight: 700;
	}

	.tab-ann-dot {
		background: #ef4444;
		color: #ffffff;
		font-size: 10px;
		font-weight: 700;
		border-radius: 999px;
		padding: 0 5px;
		height: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.footer-actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}

	.footer-btn {
		border: 1px solid #e2e8f0;
		background: #ffffff;
		color: #475569;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 10px;
		border-radius: 6px;
		cursor: pointer;
	}

	.footer-btn:hover {
		background: #f8fafc;
		color: #0f172a;
	}

	/* Toast */
	.notice-toast {
		position: fixed;
		bottom: 50px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1e293b;
		color: #ffffff;
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 600;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
	}

	/* Modals & Backdrop */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.45);
		backdrop-filter: blur(3px);
		z-index: 90;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
	}

	.composer-modal {
		background: #ffffff;
		border-radius: 12px;
		width: min(520px, 100%);
		padding: 20px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.composer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.composer-header h3 {
		margin: 0;
		font-size: 16px;
		color: #0f172a;
	}

	.close-x-btn {
		border: 0;
		background: transparent;
		color: #94a3b8;
		font-size: 18px;
		cursor: pointer;
		padding: 4px;
	}

	.close-x-btn:hover {
		color: #0f172a;
	}

	.cell-context-box {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 12px;
		color: #475569;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.cell-context-box code {
		font-family: ui-monospace, monospace;
		background: #e2e8f0;
		padding: 1px 6px;
		border-radius: 4px;
		color: #0f172a;
	}

	.ctx-formula {
		margin-left: 8px;
		color: #2563eb;
		font-family: monospace;
	}

	.composer-modal textarea {
		width: 100%;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		padding: 10px;
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
		outline: none;
	}

	.composer-modal textarea:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
	}

	.composer-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-secondary {
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #475569;
		padding: 7px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary {
		border: 0;
		background: #2563eb;
		color: #ffffff;
		padding: 7px 16px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-danger {
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #dc2626;
		padding: 7px 14px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}

	/* Detail Card Modal */
	.detail-card-modal {
		background: #ffffff;
		border-radius: 12px;
		width: min(480px, 100%);
		padding: 20px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.detail-badge-title {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tag-cell {
		background: #dbeafe;
		color: #1d4ed8;
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.tag-paint {
		background: #fef3c7;
		color: #b45309;
		font-size: 11px;
		font-weight: 700;
		padding: 2px 8px;
		border-radius: 4px;
	}

	.detail-quote {
		background: #f8fafc;
		border-left: 3px solid #2563eb;
		padding: 8px 12px;
		font-size: 12px;
		color: #475569;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.detail-quote code {
		font-family: ui-monospace, monospace;
		font-weight: 600;
		color: #0f172a;
	}

	.detail-body {
		font-size: 14px;
		line-height: 1.6;
		color: #1e293b;
		white-space: pre-wrap;
		padding: 4px 0;
	}

	.detail-meta {
		font-size: 11px;
		color: #94a3b8;
	}

	.detail-actions {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 6px;
	}

	/* Drawer Panel */
	.drawer-panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(440px, 100%);
		background: #ffffff;
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		z-index: 95;
	}

	.drawer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 20px;
		border-bottom: 1px solid #e2e8f0;
	}

	.drawer-header h3 {
		margin: 0;
		font-size: 16px;
		color: #0f172a;
	}

	.drawer-filter-bar {
		padding: 10px 20px;
		background: #f8fafc;
		border-bottom: 1px solid #e2e8f0;
		font-size: 13px;
		color: #475569;
	}

	.filter-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}

	.drawer-list {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.empty-list-hint {
		text-align: center;
		color: #94a3b8;
		padding: 60px 20px;
	}

	.empty-list-hint p {
		font-size: 15px;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.empty-list-hint span {
		font-size: 12px;
	}

	.drawer-card {
		border: 1px solid #e2e8f0;
		border-radius: 10px;
		padding: 12px;
		background: #ffffff;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 8px;
		transition: all 0.15s;
	}

	.drawer-card:hover {
		border-color: #2563eb;
		box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
	}

	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
	}

	.card-type-tag {
		background: #eff6ff;
		color: #2563eb;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.card-type-tag.paint {
		background: #fef3c7;
		color: #b45309;
	}

	.card-sheet-name {
		color: #64748b;
		font-weight: 600;
		flex: 1;
		margin-left: 8px;
	}

	.card-del-btn {
		border: 0;
		background: transparent;
		color: #94a3b8;
		cursor: pointer;
		font-size: 14px;
		padding: 2px 6px;
	}

	.card-del-btn:hover {
		color: #ef4444;
	}

	.card-cell-val {
		font-size: 12px;
		color: #64748b;
		background: #f8fafc;
		padding: 4px 8px;
		border-radius: 4px;
		font-family: monospace;
	}

	.card-comment-text {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: #1e293b;
		white-space: pre-wrap;
	}

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 11px;
		color: #94a3b8;
		border-top: 1px solid #f1f5f9;
		padding-top: 6px;
	}

	.card-jump-link {
		color: #2563eb;
		font-weight: 600;
	}

	.drawer-footer {
		display: flex;
		gap: 10px;
		padding: 14px 20px;
		border-top: 1px solid #e2e8f0;
		background: #f8fafc;
	}

	.footer-action-btn {
		flex: 1;
		border: 1px solid #cbd5e1;
		background: #ffffff;
		color: #334155;
		padding: 8px 12px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.footer-action-btn:hover {
		background: #f1f5f9;
		border-color: #94a3b8;
	}

	/* Mobile responsive adjustments */
	@media (max-width: 768px) {
		.excel-header {
			padding: 8px 12px;
		}

		.file-name {
			max-width: 140px;
		}

		.zoom-controls {
			display: none;
		}

		.stats-strip {
			display: none;
		}

		.brush-toolbar {
			top: auto;
			bottom: 60px;
			width: 92%;
			justify-content: space-around;
		}
	}
</style>
