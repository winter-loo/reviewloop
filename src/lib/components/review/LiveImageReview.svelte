<script lang="ts">
	import { onMount, tick } from 'svelte';

	interface ImageItem {
		id: string;
		index: number;
		filename: string;
		size: number;
		updatedAt: string;
		src: string;
		mediaType: string;
	}

	interface Props {
		data: {
			kind: 'image';
			token: string;
			images: ImageItem[];
		};
	}

	let { data }: Props = $props();

	type Point = { x: number; y: number };

	type Stroke = {
		color: string;
		size: number;
		points: Point[];
	};

	type ImageAnnotation = {
		id: string;
		imageIndex: number;
		filename: string;
		strokes: Stroke[];
		badgePosition: Point;
		body: string;
		createdAt: string;
	};

	const BRUSH_COLORS = [
		{ name: '红色', value: '#ef4444' },
		{ name: '橙黄', value: '#f59e0b' },
		{ name: '蓝色', value: '#3b82f6' },
		{ name: '绿色', value: '#10b981' },
		{ name: '紫色', value: '#a855f7' },
		{ name: '白色', value: '#ffffff' }
	];

	const BRUSH_SIZES = [
		{ name: '细', value: 3 },
		{ name: '中', value: 6 },
		{ name: '粗', value: 12 }
	];

	let currentIndex = $state(0);
	let currentImage = $derived(data.images[currentIndex]);
	let totalImages = $derived(data.images.length);

	let annotationMode = $state(false);
	let brushColor = $state('#ef4444');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);
	let draftComment = $state('');

	let annotations = $state<ImageAnnotation[]>([]);
	let currentAnnotations = $derived(annotations.filter((ann) => ann.imageIndex === currentIndex));
	let totalAnnotationCount = $derived(annotations.length);

	let selectedAnnotationId = $state<string | null>(null);
	let showListModal = $state(false);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	let imageElement = $state<HTMLImageElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let wrapperElement = $state<HTMLDivElement | null>(null);
	let stageElement = $state<HTMLElement | null>(null);
	let composerTextarea = $state<HTMLTextAreaElement | null>(null);

	// Zoom & Pan state (双指缩放与平移标注)
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPinching = $state(false);
	let isPanning = $state(false);
	let isMousePanning = $state(false);
	let isSpacePressed = $state(false);
	let isAnimating = $state(false);

	// Touch tracking
	let initialPinchDist = 0;
	let initialPinchZoom = 1;
	let initialPinchCenter = { x: 0, y: 0 };
	let initialPan = { x: 0, y: 0 };
	let lastTouchPos = { x: 0, y: 0 };
	let lastMousePos = { x: 0, y: 0 };
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTime = 0;
	let lastTapTime = 0;
	let lastTapPos = { x: 0, y: 0 };

	const storageKey = $derived(`reviewloop:live-image:${data.token}`);

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

		// Preload other images for instantaneous switching
		data.images.forEach((img) => {
			const preload = new Image();
			preload.src = img.src;
		});

		window.addEventListener('resize', handleResize);

		// Non-passive touch and wheel listeners on stage to allow e.preventDefault() for pinch-zoom
		const stage = stageElement;
		if (stage) {
			stage.addEventListener('touchstart', handleStageTouchStart, { passive: false });
			stage.addEventListener('touchmove', handleStageTouchMove, { passive: false });
			stage.addEventListener('touchend', handleStageTouchEnd);
			stage.addEventListener('touchcancel', handleStageTouchEnd);
			stage.addEventListener('wheel', handleWheel, { passive: false });
			stage.addEventListener('mousedown', handleStageMouseDown);
			stage.addEventListener('dblclick', handleStageDblClick);
		}

		window.addEventListener('mousemove', handleStageMouseMove);
		window.addEventListener('mouseup', handleStageMouseUp);

		return () => {
			window.removeEventListener('resize', handleResize);
			window.removeEventListener('mousemove', handleStageMouseMove);
			window.removeEventListener('mouseup', handleStageMouseUp);
			if (stage) {
				stage.removeEventListener('touchstart', handleStageTouchStart);
				stage.removeEventListener('touchmove', handleStageTouchMove);
				stage.removeEventListener('touchend', handleStageTouchEnd);
				stage.removeEventListener('touchcancel', handleStageTouchEnd);
				stage.removeEventListener('wheel', handleWheel);
				stage.removeEventListener('mousedown', handleStageMouseDown);
				stage.removeEventListener('dblclick', handleStageDblClick);
			}
		};
	});

	function persistAnnotations(next: ImageAnnotation[]) {
		annotations = next;
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
		} catch {
			showNotice('设备存储不足，标注仅临时保留');
		}
	}

	function showNotice(msg: string) {
		notice = msg;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => {
			notice = '';
		}, 2600);
	}

	function resetZoom(animated = true) {
		if (animated) {
			isAnimating = true;
			setTimeout(() => {
				isAnimating = false;
			}, 250);
		}
		zoom = 1;
		panX = 0;
		panY = 0;
		isPinching = false;
		isPanning = false;
		isMousePanning = false;
	}

	function clampPan() {
		if (!stageElement || zoom <= 1.02) {
			panX = 0;
			panY = 0;
			return;
		}
		const stageRect = stageElement.getBoundingClientRect();
		const baseW = imageElement?.offsetWidth || 300;
		const baseH = imageElement?.offsetHeight || 300;
		const maxPanX = Math.max(0, (baseW * zoom - stageRect.width) / 2) + stageRect.width * 0.35;
		const maxPanY = Math.max(0, (baseH * zoom - stageRect.height) / 2) + stageRect.height * 0.35;
		panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
		panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
	}

	function applyZoomAtPoint(targetZoom: number, clientX: number, clientY: number, animated = false) {
		const clampedZoom = Math.min(5, Math.max(1, targetZoom));
		if (clampedZoom <= 1.02) {
			resetZoom(animated);
			return;
		}
		if (animated) {
			isAnimating = true;
			setTimeout(() => {
				isAnimating = false;
			}, 250);
		}
		if (!stageElement) {
			zoom = clampedZoom;
			return;
		}
		const stageRect = stageElement.getBoundingClientRect();
		const cx = stageRect.left + stageRect.width / 2;
		const cy = stageRect.top + stageRect.height / 2;
		const fx = clientX - cx;
		const fy = clientY - cy;

		const zoomRatio = clampedZoom / zoom;
		panX = fx - zoomRatio * (fx - panX);
		panY = fy - zoomRatio * (fy - panY);
		zoom = clampedZoom;
		clampPan();
	}

	function applyZoomDelta(delta: number) {
		if (!stageElement) return;
		const stageRect = stageElement.getBoundingClientRect();
		const cx = stageRect.left + stageRect.width / 2;
		const cy = stageRect.top + stageRect.height / 2;
		applyZoomAtPoint(zoom + delta, cx, cy, true);
	}

	function checkDoubleTap(clientX: number, clientY: number) {
		const now = Date.now();
		const dt = now - lastTapTime;
		const dist = Math.hypot(clientX - lastTapPos.x, clientY - lastTapPos.y);
		lastTapTime = now;
		lastTapPos = { x: clientX, y: clientY };
		if (dt > 40 && dt < 300 && dist < 35) {
			if (zoom > 1.1) {
				resetZoom(true);
			} else {
				applyZoomAtPoint(2.5, clientX, clientY, true);
			}
			return true;
		}
		return false;
	}

	function goToNext() {
		if (currentIndex < totalImages - 1) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换图片将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex += 1;
			selectedAnnotationId = null;
		}
	}

	function goToPrev() {
		if (currentIndex > 0) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换图片将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex -= 1;
			selectedAnnotationId = null;
		}
	}

	function goToIndex(idx: number) {
		if (idx >= 0 && idx < totalImages && idx !== currentIndex) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换图片将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex = idx;
			selectedAnnotationId = null;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable)
		) {
			return;
		}

		if (event.code === 'Space' && !isSpacePressed) {
			isSpacePressed = true;
		} else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
			event.preventDefault();
			goToNext();
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
			event.preventDefault();
			goToPrev();
		} else if (event.key === 'Escape') {
			if (draftStrokes.length > 0) {
				cancelDraft();
			} else if (showListModal) {
				showListModal = false;
			} else if (zoom > 1.05) {
				resetZoom(true);
			} else if (annotationMode) {
				annotationMode = false;
			}
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			applyZoomDelta(0.5);
		} else if (event.key === '-' || event.key === '_') {
			event.preventDefault();
			applyZoomDelta(-0.5);
		} else if (event.key === '0') {
			event.preventDefault();
			resetZoom(true);
		}
	}

	function handleKeyup(event: KeyboardEvent) {
		if (event.code === 'Space') {
			isSpacePressed = false;
			isMousePanning = false;
		}
	}

	function handleStageTouchStart(e: TouchEvent) {
		if (e.touches.length === 2) {
			// Two fingers pinch / pan
			isPinching = true;
			isPanning = false;
			if (isDrawing) {
				isDrawing = false;
				currentStroke = null;
				redrawDraftCanvas();
			}
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
			initialPinchZoom = zoom;
			initialPinchCenter = {
				x: (t1.clientX + t2.clientX) / 2,
				y: (t1.clientY + t2.clientY) / 2
			};
			initialPan = { x: panX, y: panY };
			e.preventDefault();
		} else if (e.touches.length === 1) {
			touchStartX = e.touches[0].clientX;
			touchStartY = e.touches[0].clientY;
			lastTouchPos = { x: touchStartX, y: touchStartY };
			touchStartTime = Date.now();

			if (checkDoubleTap(touchStartX, touchStartY)) {
				e.preventDefault();
				return;
			}

			if (!annotationMode && zoom > 1.05) {
				isPanning = true;
				e.preventDefault();
			}
		}
	}

	function handleStageTouchMove(e: TouchEvent) {
		if (isPinching && e.touches.length === 2) {
			e.preventDefault();
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
			if (initialPinchDist > 10) {
				const scaleFactor = currentDist / initialPinchDist;
				const targetZoom = Math.min(5, Math.max(1, initialPinchZoom * scaleFactor));
				const currentCenter = {
					x: (t1.clientX + t2.clientX) / 2,
					y: (t1.clientY + t2.clientY) / 2
				};
				const centerDeltaX = currentCenter.x - initialPinchCenter.x;
				const centerDeltaY = currentCenter.y - initialPinchCenter.y;

				if (stageElement) {
					const stageRect = stageElement.getBoundingClientRect();
					const cx = stageRect.left + stageRect.width / 2;
					const cy = stageRect.top + stageRect.height / 2;
					const fx = initialPinchCenter.x - cx;
					const fy = initialPinchCenter.y - cy;

					const zoomRatio = targetZoom / initialPinchZoom;
					panX = fx - zoomRatio * (fx - initialPan.x) + centerDeltaX;
					panY = fy - zoomRatio * (fy - initialPan.y) + centerDeltaY;
					zoom = targetZoom;
				}
			}
		} else if (isPanning && e.touches.length === 1) {
			e.preventDefault();
			const dx = e.touches[0].clientX - lastTouchPos.x;
			const dy = e.touches[0].clientY - lastTouchPos.y;
			panX += dx;
			panY += dy;
			lastTouchPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
			clampPan();
		}
	}

	function handleStageTouchEnd(e: TouchEvent) {
		if (isPinching) {
			if (e.touches.length < 2) {
				isPinching = false;
				if (zoom <= 1.05) {
					resetZoom(true);
				} else {
					clampPan();
				}
			}
			return;
		}

		if (isPanning) {
			isPanning = false;
			clampPan();
			return;
		}

		// Horizontal swipe for switching images when not zoomed and not in annotation mode
		if (!annotationMode && zoom <= 1.05 && e.changedTouches.length === 1) {
			const deltaX = e.changedTouches[0].clientX - touchStartX;
			const deltaY = e.changedTouches[0].clientY - touchStartY;
			const elapsed = Date.now() - touchStartTime;
			if (elapsed < 600 && Math.abs(deltaX) > 45 && Math.abs(deltaY) < 60) {
				if (deltaX < 0) {
					goToNext();
				} else {
					goToPrev();
				}
			}
		}
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const zoomDelta = -e.deltaY * (e.ctrlKey ? 0.01 : 0.0015);
		applyZoomAtPoint(zoom + zoomDelta * zoom, e.clientX, e.clientY);
	}

	function handleStageMouseDown(e: MouseEvent) {
		if (e.button === 1 || isSpacePressed || (!annotationMode && zoom > 1.05 && e.button === 0)) {
			e.preventDefault();
			isMousePanning = true;
			lastMousePos = { x: e.clientX, y: e.clientY };
		}
	}

	function handleStageMouseMove(e: MouseEvent) {
		if (isMousePanning) {
			const dx = e.clientX - lastMousePos.x;
			const dy = e.clientY - lastMousePos.y;
			panX += dx;
			panY += dy;
			lastMousePos = { x: e.clientX, y: e.clientY };
			clampPan();
		}
	}

	function handleStageMouseUp() {
		if (isMousePanning) {
			isMousePanning = false;
			clampPan();
		}
	}

	function handleStageDblClick(e: MouseEvent) {
		if (zoom > 1.1) {
			resetZoom(true);
		} else {
			applyZoomAtPoint(2.5, e.clientX, e.clientY, true);
		}
	}

	function handleResize() {
		if (!canvasElement || !imageElement) return;
		syncCanvasDimensions();
		redrawDraftCanvas();
		clampPan();
	}

	function syncCanvasDimensions() {
		if (!canvasElement || !imageElement) return;
		const baseW = imageElement.offsetWidth;
		const baseH = imageElement.offsetHeight;
		if (baseW <= 0 || baseH <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		canvasElement.width = baseW * dpr;
		canvasElement.height = baseH * dpr;
		const ctx = canvasElement.getContext('2d');
		if (ctx) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
	}

	function getNormalizedPoint(e: PointerEvent | { clientX: number; clientY: number }): Point | null {
		if (!canvasElement) return null;
		const rect = canvasElement.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		return {
			x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
			y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
		};
	}

	function handlePointerDown(e: PointerEvent) {
		if (isPinching || isSpacePressed || !annotationMode || e.button !== 0 || !canvasElement) return;
		const pt = getNormalizedPoint(e);
		if (!pt) return;
		e.preventDefault();
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
		if (isPinching || isSpacePressed || !isDrawing || !currentStroke || !canvasElement) return;
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
			tick().then(() => composerTextarea?.focus());
		}
	}

	function handlePointerCancel() {
		if (!isDrawing) return;
		isDrawing = false;
		currentStroke = null;
		redrawDraftCanvas();
	}

	function drawLatestStrokeSegment() {
		if (!canvasElement || !imageElement || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		const baseW = imageElement.offsetWidth;
		const baseH = imageElement.offsetHeight;
		const pts = currentStroke.points;
		const p0 = pts[pts.length - 2];
		const p1 = pts[pts.length - 1];

		ctx.save();
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
		if (!canvasElement || !imageElement) return;
		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;
		const baseW = imageElement.offsetWidth;
		const baseH = imageElement.offsetHeight;
		ctx.clearRect(0, 0, baseW, baseH);

		const all = currentStroke ? [...draftStrokes, currentStroke] : draftStrokes;
		for (const stroke of all) {
			if (stroke.points.length === 0) continue;
			ctx.save();
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
			ctx.restore();
		}
	}

	function undoLastStroke() {
		if (draftStrokes.length > 0) {
			draftStrokes = draftStrokes.slice(0, -1);
			redrawDraftCanvas();
		}
	}

	function cancelDraft() {
		draftStrokes = [];
		draftComment = '';
		currentStroke = null;
		redrawDraftCanvas();
	}

	function saveDraftAnnotation() {
		if (draftStrokes.length === 0 || !currentImage) return null;
		const firstPoint = draftStrokes[0].points[0] ?? { x: 0.5, y: 0.5 };
		const annotation: ImageAnnotation = {
			id: crypto.randomUUID(),
			imageIndex: currentIndex,
			filename: currentImage.filename,
			strokes: draftStrokes,
			badgePosition: { ...firstPoint },
			body: draftComment.trim() || '（画笔标注）',
			createdAt: new Date().toISOString()
		};

		persistAnnotations([...annotations, annotation]);
		cancelDraft();
		showNotice('已保存标注');
		return annotation;
	}

	function removeAnnotation(id: string) {
		persistAnnotations(annotations.filter((ann) => ann.id !== id));
		if (selectedAnnotationId === id) selectedAnnotationId = null;
		showNotice('标注已删除');
	}

	function pointsToSvgPath(points: Point[]): string {
		if (points.length === 0) return '';
		if (points.length === 1) {
			const x = points[0].x * 1000;
			const y = points[0].y * 1000;
			return `M ${x} ${y} L ${x + 0.1} ${y + 0.1}`;
		}
		let d = `M ${points[0].x * 1000} ${points[0].y * 1000}`;
		for (let i = 1; i < points.length; i++) {
			const p0 = points[i - 1];
			const p1 = points[i];
			const midX = ((p0.x + p1.x) / 2) * 1000;
			const midY = ((p0.y + p1.y) / 2) * 1000;
			d += ` Q ${p0.x * 1000} ${p0.y * 1000} ${midX} ${midY}`;
		}
		const last = points[points.length - 1];
		d += ` L ${last.x * 1000} ${last.y * 1000}`;
		return d;
	}

	function formatBytes(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function buildShareText(): string {
		const lines = [`Review: 图片评审（共 ${totalImages} 张）`, location.href, ''];

		for (let i = 0; i < totalImages; i++) {
			const img = data.images[i];
			const imgAnns = annotations.filter((ann) => ann.imageIndex === i);
			if (imgAnns.length > 0) {
				lines.push(`【图片 ${i + 1}/${totalImages}: ${img.filename}】`);
				imgAnns.forEach((ann, idx) => {
					lines.push(`  ${idx + 1}. ${ann.body}`);
				});
				lines.push('');
			}
		}

		if (totalAnnotationCount === 0) {
			lines.push('暂无标注内容');
		}

		return lines.join('\n');
	}

	async function shareAnnotations() {
		const text = buildShareText();
		try {
			if (navigator.share) {
				await navigator.share({
					title: `图片评审 - ${currentImage?.filename ?? ''}`,
					text
				});
				showNotice('已调起分享面板');
			} else {
				await navigator.clipboard.writeText(text);
				showNotice('标注内容已复制到剪贴板');
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				showNotice('分享失败，请重试');
			}
		}
	}

	async function saveAndShare() {
		const ann = saveDraftAnnotation();
		if (ann) {
			await shareAnnotations();
		}
	}

	function exportAnnotatedImage() {
		if (!imageElement || !currentImage) return;
		const canvas = document.createElement('canvas');
		const naturalW = imageElement.naturalWidth || imageElement.clientWidth || 800;
		const naturalH = imageElement.naturalHeight || imageElement.clientHeight || 600;
		canvas.width = naturalW;
		canvas.height = naturalH;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// 1. Draw base image
		ctx.drawImage(imageElement, 0, 0, naturalW, naturalH);

		// 2. Draw annotations for current image
		const anns = currentAnnotations;
		const scale = Math.max(naturalW, naturalH) / 1000;

		anns.forEach((ann, idx) => {
			ann.strokes.forEach((stroke) => {
				if (stroke.points.length === 0) return;
				ctx.save();
				ctx.strokeStyle = stroke.color;
				ctx.lineWidth = Math.max(2, stroke.size * scale);
				ctx.lineCap = 'round';
				ctx.lineJoin = 'round';

				ctx.beginPath();
				ctx.moveTo(stroke.points[0].x * naturalW, stroke.points[0].y * naturalH);
				for (let i = 1; i < stroke.points.length; i++) {
					const p0 = stroke.points[i - 1];
					const p1 = stroke.points[i];
					const midX = ((p0.x + p1.x) / 2) * naturalW;
					const midY = ((p0.y + p1.y) / 2) * naturalH;
					ctx.quadraticCurveTo(p0.x * naturalW, p0.y * naturalH, midX, midY);
				}
				const last = stroke.points[stroke.points.length - 1];
				ctx.lineTo(last.x * naturalW, last.y * naturalH);
				ctx.stroke();
				ctx.restore();
			});

			// 3. Draw badge
			const bx = ann.badgePosition.x * naturalW;
			const by = ann.badgePosition.y * naturalH;
			const radius = Math.max(12, 14 * scale);

			ctx.save();
			ctx.beginPath();
			ctx.arc(bx, by, radius, 0, Math.PI * 2);
			ctx.fillStyle = ann.strokes[0]?.color || '#ef4444';
			ctx.fill();
			ctx.lineWidth = Math.max(1.5, 2 * scale);
			ctx.strokeStyle = '#ffffff';
			ctx.stroke();

			ctx.fillStyle = '#ffffff';
			ctx.font = `bold ${Math.round(Math.max(11, 13 * scale))}px sans-serif`;
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(idx + 1), bx, by);
			ctx.restore();
		});

		try {
			const a = document.createElement('a');
			a.download = `annotated-${currentImage.filename}`;
			a.href = canvas.toDataURL('image/png');
			a.click();
			showNotice('已成功导出带标注图片');
		} catch {
			showNotice('导出图片失败');
		}
	}

	$effect(() => {
		if (annotationMode) {
			tick().then(() => {
				syncCanvasDimensions();
				redrawDraftCanvas();
			});
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyup} />

<svelte:head>
	<title>{currentImage ? currentImage.filename : '图片评审'} · Live Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="live-image-container">
	<!-- Top Navigation and Tool Header -->
	<header class="top-header">
		<div class="file-meta">
			<div class="filename-row">
				<strong title={currentImage?.filename}>{currentImage?.filename}</strong>
				{#if totalImages > 1}
					<span class="badge-counter">{currentIndex + 1} / {totalImages}</span>
				{/if}
			</div>
			<div class="meta-sub">
				<span>{formatBytes(currentImage?.size || 0)}</span>
				<span class="divider">·</span>
				<span>快捷键：左右/上下换图 · 双指/滚轮放大</span>
			</div>
		</div>

		<div class="header-actions">
			{#if currentAnnotations.length > 0}
				<button class="ghost-btn" type="button" onclick={exportAnnotatedImage} title="下载当前合成标注后的图片">
					<span>⬇️</span> 导出图片
				</button>
			{/if}

			{#if totalAnnotationCount > 0}
				<button class="ghost-btn" type="button" onclick={() => (showListModal = true)}>
					标注 ({currentAnnotations.length})
				</button>
			{/if}

			<button
				class="action-btn"
				class:active={annotationMode}
				type="button"
				aria-pressed={annotationMode}
				onclick={() => {
					annotationMode = !annotationMode;
					if (!annotationMode) cancelDraft();
				}}
			>
				{annotationMode ? '完成标注' : '✏️ 画笔标注'}
			</button>

			{#if totalAnnotationCount > 0}
				<button class="action-btn primary" type="button" onclick={shareAnnotations}>
					分享 {totalAnnotationCount} 条
				</button>
			{/if}
		</div>
	</header>

	<!-- Paintbrush Controls Bar (when annotation mode is active) -->
	{#if annotationMode}
		<div class="brush-toolbar" role="toolbar" aria-label="画笔选项">
			<div class="toolbar-group colors">
				{#each BRUSH_COLORS as color}
					<button
						type="button"
						class="color-dot"
						class:active={brushColor === color.value}
						style:background={color.value}
						title={color.name}
						aria-label={color.name}
						onclick={() => (brushColor = color.value)}
					></button>
				{/each}
			</div>

			<div class="toolbar-divider"></div>

			<div class="toolbar-group sizes">
				{#each BRUSH_SIZES as size}
					<button
						type="button"
						class="size-btn"
						class:active={brushSize === size.value}
						title={`画笔大小: ${size.name}`}
						onclick={() => (brushSize = size.value)}
					>
						<span class="size-preview" style:width="{size.value * 1.5 + 4}px" style:height="{size.value * 1.5 + 4}px" style:background={brushColor}></span>
						<span>{size.name}</span>
					</button>
				{/each}
			</div>

			<div class="toolbar-divider"></div>

			<div class="toolbar-group actions">
				<button
					type="button"
					class="tool-btn"
					disabled={draftStrokes.length === 0}
					title="撤销上一笔"
					onclick={undoLastStroke}
				>
					↩️ 撤销
				</button>
				<button
					type="button"
					class="tool-btn"
					disabled={draftStrokes.length === 0}
					title="清空当前笔画"
					onclick={cancelDraft}
				>
					🗑️ 清空
				</button>
			</div>
		</div>
	{/if}

	<!-- Main Stage: Full-screen Image Viewport ("每一个图片独占一屏") -->
	<main
		bind:this={stageElement}
		class="stage"
		class:space-panning={isSpacePressed || isMousePanning}
		role="region"
		aria-label="图片展示区"
	>
		<!-- Left navigation arrow for previous image -->
		{#if totalImages > 1}
			<button
				class="nav-arrow left"
				type="button"
				disabled={currentIndex === 0}
				onclick={goToPrev}
				title="上一张 (← / ↑)"
				aria-label="上一张图片"
			>
				‹
			</button>
		{/if}

		<!-- Centered Image Container with Zoom & Pan Transform -->
		<div
			class="image-wrapper"
			class:animating={isAnimating}
			bind:this={wrapperElement}
			style:transform="translate3d({panX}px, {panY}px, 0) scale({zoom})"
		>
			{#if currentImage}
				<img
					bind:this={imageElement}
					src={currentImage.src}
					alt={currentImage.filename}
					draggable="false"
					onload={handleResize}
				/>

				<!-- SVG Overlay for Saved Annotations -->
				<svg class="annotations-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none">
					{#each currentAnnotations as ann, idx (ann.id)}
						<g
							class="annotation-item"
							class:active={selectedAnnotationId === ann.id}
							role="button"
							tabindex="0"
							aria-label={`标注 ${idx + 1}: ${ann.body}`}
							onclick={() => (selectedAnnotationId = selectedAnnotationId === ann.id ? null : ann.id)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									selectedAnnotationId = selectedAnnotationId === ann.id ? null : ann.id;
								}
							}}
						>
							{#each ann.strokes as stroke}
								<path
									d={pointsToSvgPath(stroke.points)}
									stroke={stroke.color}
									stroke-width={stroke.size * 1.5}
									stroke-linecap="round"
									stroke-linejoin="round"
									fill="none"
								/>
							{/each}
							<!-- Number badge at annotation origin -->
							<g transform="translate({ann.badgePosition.x * 1000}, {ann.badgePosition.y * 1000})">
								<circle r="14" fill={ann.strokes[0]?.color || '#ef4444'} stroke="#ffffff" stroke-width="2.5" />
								<text
									text-anchor="middle"
									dominant-baseline="central"
									fill="#ffffff"
									font-size="12"
									font-weight="bold"
								>
									{idx + 1}
								</text>
							</g>
						</g>
					{/each}
				</svg>

				<!-- Active Drawing Canvas -->
				{#if annotationMode}
					<canvas
						bind:this={canvasElement}
						class="drawing-canvas"
						onpointerdown={handlePointerDown}
						onpointermove={handlePointerMove}
						onpointerup={handlePointerUp}
						onpointercancel={handlePointerCancel}
					></canvas>
				{/if}
			{/if}
		</div>

		<!-- Right navigation arrow for next image -->
		{#if totalImages > 1}
			<button
				class="nav-arrow right"
				type="button"
				disabled={currentIndex === totalImages - 1}
				onclick={goToNext}
				title="下一张 (→ / ↓)"
				aria-label="下一张图片"
			>
				›
			</button>
		{/if}

		<!-- Floating Zoom Controls Pill -->
		<div class="zoom-controls" role="group" aria-label="缩放控制">
			<button
				type="button"
				class="zoom-btn"
				title="缩小 (快捷键: -)"
				disabled={zoom <= 1.01}
				onclick={() => applyZoomDelta(-0.5)}
			>
				−
			</button>
			<button
				type="button"
				class="zoom-level-btn"
				title="点击还原 100% (双击图片也可放大/还原)"
				onclick={() => (zoom > 1.05 ? resetZoom(true) : applyZoomDelta(1.0))}
			>
				{Math.round(zoom * 100)}%
			</button>
			<button
				type="button"
				class="zoom-btn"
				title="放大 (快捷键: +)"
				disabled={zoom >= 4.99}
				onclick={() => applyZoomDelta(0.5)}
			>
				+
			</button>
			{#if zoom > 1.05}
				<button
					type="button"
					class="zoom-reset-btn"
					title="还原原始尺寸 (快捷键: 0 或 Esc)"
					onclick={() => resetZoom(true)}
				>
					⟲ 还原
				</button>
			{/if}
		</div>
	</main>

	<!-- Bottom Image Indicator Bar / Thumbnails -->
	{#if totalImages > 1}
		<nav class="bottom-pagination" aria-label="图片切换导航">
			{#each data.images as img, idx}
				<button
					type="button"
					class="page-indicator-dot"
					class:active={idx === currentIndex}
					onclick={() => goToIndex(idx)}
					title={`${idx + 1}. ${img.filename}`}
					aria-label={`切换至第 ${idx + 1} 张图片：${img.filename}`}
				>
					<span class="dot-num">{idx + 1}</span>
				</button>
			{/each}
		</nav>
	{/if}

	<!-- Comment Composer when strokes have been drawn -->
	{#if draftStrokes.length > 0}
		<div class="composer-drawer" role="dialog" aria-modal="true" aria-label="添加画笔标注批注">
			<div class="composer-header">
				<strong>✏️ 已完成画笔标注（共 {draftStrokes.length} 笔）</strong>
				<span class="hint">可以输入批注文字，也可直接保存</span>
			</div>
			<textarea
				bind:this={composerTextarea}
				bind:value={draftComment}
				placeholder="写下关于此标注的修改意见或批注内容…"
				rows="2"
				maxlength="3000"
			></textarea>
			<div class="composer-actions">
				<button type="button" class="btn-cancel" onclick={cancelDraft}>放弃</button>
				<button type="button" class="btn-save" onclick={saveDraftAnnotation}>保存标注</button>
				<button type="button" class="btn-primary" onclick={saveAndShare}>保存并分享</button>
			</div>
		</div>
	{/if}

	<!-- Annotation List Drawer -->
	{#if showListModal}
		<button class="backdrop" type="button" aria-label="关闭批注列表" onclick={() => (showListModal = false)}></button>
		<div class="annotations-sidebar" role="dialog" aria-modal="true" aria-label="标注列表">
			<div class="sidebar-header">
				<h3>标注列表 · 当前第 {currentIndex + 1} 张（共 {currentAnnotations.length} 条）</h3>
				<button type="button" class="close-btn" onclick={() => (showListModal = false)}>✕</button>
			</div>
			<div class="sidebar-content">
				{#if currentAnnotations.length === 0}
					<div class="empty-state">当前图片暂无标注。点击上方“画笔标注”即可用画笔自由圈画。</div>
				{:else}
					<ul class="annotation-list">
						{#each currentAnnotations as ann, idx (ann.id)}
							<li>
								<div
									class="annotation-card"
									class:active={selectedAnnotationId === ann.id}
									role="button"
									tabindex="0"
									onclick={() => (selectedAnnotationId = ann.id)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											selectedAnnotationId = ann.id;
										}
									}}
								>
									<div class="card-header">
										<span class="card-badge" style:background={ann.strokes[0]?.color || '#ef4444'}>{idx + 1}</span>
										<span class="card-time">{new Date(ann.createdAt).toLocaleTimeString()}</span>
										<button
											type="button"
											class="card-delete-btn"
											title="删除标注"
											onclick={(e) => {
												e.stopPropagation();
												removeAnnotation(ann.id);
											}}
										>
											删除
										</button>
									</div>
									<p class="card-body">{ann.body}</p>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Toast Notice -->
	{#if notice}
		<div class="notice-toast" role="status">{notice}</div>
	{/if}
</div>

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html, body) {
		margin: 0;
		padding: 0;
		height: 100%;
		overflow: hidden;
		background: #09090b;
		color: #f4f4f5;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	}

	.live-image-container {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		width: 100vw;
		overflow: hidden;
		background: #09090b;
		position: relative;
	}

	/* Top Header */
	.top-header {
		flex: none;
		height: 58px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		background: rgba(18, 18, 23, 0.92);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		z-index: 20;
	}

	.file-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.filename-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.filename-row strong {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 320px;
		color: #ffffff;
	}

	.badge-counter {
		background: #27272a;
		color: #e4e4e7;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.5px;
	}

	.meta-sub {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: #a1a1aa;
	}

	.divider {
		opacity: 0.5;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	button {
		font-family: inherit;
		cursor: pointer;
		touch-action: manipulation;
	}

	.action-btn, .ghost-btn {
		height: 36px;
		padding: 0 13px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		transition: all 0.15s ease;
	}

	.ghost-btn {
		background: transparent;
		color: #d4d4d8;
		border: 1px solid rgba(255, 255, 255, 0.15);
	}

	.ghost-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #ffffff;
	}

	.action-btn {
		background: #27272a;
		color: #ffffff;
		border: 1px solid #3f3f46;
	}

	.action-btn:hover {
		background: #3f3f46;
	}

	.action-btn.active {
		background: #dc2626;
		border-color: #ef4444;
		color: #ffffff;
		box-shadow: 0 0 12px rgba(220, 38, 38, 0.4);
	}

	.action-btn.primary {
		background: #2563eb;
		border-color: #3b82f6;
		color: #ffffff;
	}

	.action-btn.primary:hover {
		background: #1d4ed8;
	}

	/* Brush Toolbar */
	.brush-toolbar {
		position: absolute;
		top: 66px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 10px;
		background: rgba(24, 24, 27, 0.95);
		backdrop-filter: blur(16px);
		padding: 7px 14px;
		border-radius: 12px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
		z-index: 25;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.color-dot {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid transparent;
		padding: 0;
		transition: transform 0.15s, border-color 0.15s;
	}

	.color-dot:hover {
		transform: scale(1.15);
	}

	.color-dot.active {
		border-color: #ffffff;
		box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
		transform: scale(1.2);
	}

	.toolbar-divider {
		width: 1px;
		height: 20px;
		background: rgba(255, 255, 255, 0.15);
	}

	.size-btn {
		height: 28px;
		padding: 0 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: #a1a1aa;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.size-btn.active {
		background: #3f3f46;
		color: #ffffff;
		border-color: #52525b;
	}

	.size-preview {
		border-radius: 50%;
		display: inline-block;
	}

	.tool-btn {
		height: 28px;
		padding: 0 8px;
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 6px;
		color: #e4e4e7;
		font-size: 12px;
	}

	.tool-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* Main Stage ("每一个图片独占一屏") */
	.stage {
		flex: 1;
		width: 100%;
		height: calc(100dvh - 58px);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		overflow: hidden;
		user-select: none;
		touch-action: none;
	}

	.stage.space-panning {
		cursor: grab !important;
	}

	.image-wrapper {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		max-width: calc(100vw - 80px);
		max-height: calc(100dvh - 100px);
		transform-origin: center center;
		will-change: transform;
	}

	.image-wrapper.animating {
		transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.image-wrapper img {
		max-width: calc(100vw - 80px);
		max-height: calc(100dvh - 100px);
		width: auto;
		height: auto;
		object-fit: contain;
		display: block;
		border-radius: 6px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.annotations-svg, .drawing-canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 6px;
	}

	.annotations-svg {
		pointer-events: none;
		z-index: 10;
	}

	.annotation-item {
		pointer-events: auto;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.annotation-item:hover path {
		filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.8));
	}

	.annotation-item.active path {
		filter: drop-shadow(0 0 8px #3b82f6);
		stroke-width: 8;
	}

	.drawing-canvas {
		cursor: crosshair;
		touch-action: none;
		z-index: 15;
	}

	/* Nav Arrows */
	.nav-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		width: 44px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(24, 24, 27, 0.6);
		backdrop-filter: blur(8px);
		color: #ffffff;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		font-size: 28px;
		line-height: 1;
		transition: all 0.15s ease;
		z-index: 18;
	}

	.nav-arrow:hover:not(:disabled) {
		background: rgba(39, 39, 42, 0.9);
		transform: translateY(-50%) scale(1.08);
	}

	.nav-arrow:disabled {
		opacity: 0.15;
		cursor: not-allowed;
	}

	.nav-arrow.left {
		left: 14px;
	}

	.nav-arrow.right {
		right: 14px;
	}

	/* Bottom Pagination Dots */
	.bottom-pagination {
		position: absolute;
		bottom: 14px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		background: rgba(24, 24, 27, 0.75);
		backdrop-filter: blur(12px);
		padding: 5px 10px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		z-index: 18;
	}

	.page-indicator-dot {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		border: 0;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #a1a1aa;
		font-size: 11px;
		font-weight: 600;
		transition: all 0.2s;
	}

	.page-indicator-dot.active {
		background: #2563eb;
		color: #ffffff;
		transform: scale(1.15);
	}

	/* Floating Zoom Controls Pill */
	.zoom-controls {
		position: absolute;
		right: 16px;
		bottom: 16px;
		display: flex;
		align-items: center;
		gap: 2px;
		background: rgba(24, 24, 27, 0.88);
		backdrop-filter: blur(14px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 999px;
		padding: 4px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
		z-index: 18;
		user-select: none;
	}

	.zoom-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 50%;
		color: #e4e4e7;
		font-size: 16px;
		font-weight: 500;
		transition: background 0.15s, color 0.15s;
		padding: 0;
	}

	.zoom-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
		color: #ffffff;
	}

	.zoom-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.zoom-level-btn {
		min-width: 48px;
		height: 28px;
		padding: 0 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: 0;
		border-radius: 6px;
		color: #e4e4e7;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		transition: background 0.15s, color 0.15s;
	}

	.zoom-level-btn:hover {
		background: rgba(255, 255, 255, 0.1);
		color: #ffffff;
	}

	.zoom-reset-btn {
		height: 28px;
		padding: 0 8px;
		display: flex;
		align-items: center;
		gap: 3px;
		background: #3f3f46;
		border: 0;
		border-radius: 999px;
		color: #ffffff;
		font-size: 11px;
		font-weight: 600;
		margin-left: 2px;
		transition: background 0.15s;
	}

	.zoom-reset-btn:hover {
		background: #52525b;
	}

	/* Composer Drawer */
	.composer-drawer {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		width: min(520px, calc(100% - 32px));
		background: #18181b;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 16px;
		padding: 14px 16px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
		display: flex;
		flex-direction: column;
		gap: 10px;
		z-index: 30;
	}

	.composer-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 13px;
	}

	.composer-header strong {
		color: #ffffff;
	}

	.composer-header .hint {
		color: #71717a;
		font-size: 12px;
	}

	.composer-drawer textarea {
		width: 100%;
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 8px;
		padding: 10px;
		color: #ffffff;
		font-family: inherit;
		font-size: 14px;
		resize: none;
		outline: none;
	}

	.composer-drawer textarea:focus {
		border-color: #2563eb;
		box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
	}

	.composer-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-cancel, .btn-save, .btn-primary {
		height: 34px;
		padding: 0 14px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
	}

	.btn-cancel {
		background: transparent;
		border: 1px solid #3f3f46;
		color: #a1a1aa;
	}

	.btn-cancel:hover {
		color: #ffffff;
	}

	.btn-save {
		background: #3f3f46;
		border: 1px solid #52525b;
		color: #ffffff;
	}

	.btn-save:hover {
		background: #52525b;
	}

	.btn-primary {
		background: #2563eb;
		border: 1px solid #3b82f6;
		color: #ffffff;
	}

	.btn-primary:hover {
		background: #1d4ed8;
	}

	/* Annotations Sidebar */
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		border: 0;
		z-index: 40;
	}

	.annotations-sidebar {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(380px, 90vw);
		background: #18181b;
		border-left: 1px solid rgba(255, 255, 255, 0.1);
		display: flex;
		flex-direction: column;
		z-index: 45;
		box-shadow: -10px 0 40px rgba(0, 0, 0, 0.5);
	}

	.sidebar-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
	}

	.sidebar-header h3 {
		margin: 0;
		font-size: 14px;
		color: #ffffff;
	}

	.close-btn {
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background: transparent;
		border: 0;
		color: #a1a1aa;
		font-size: 16px;
	}

	.close-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: #ffffff;
	}

	.sidebar-content {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
	}

	.empty-state {
		text-align: center;
		padding: 40px 16px;
		color: #71717a;
		font-size: 13px;
		line-height: 1.6;
	}

	.annotation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.annotation-card {
		background: #27272a;
		border: 1px solid #3f3f46;
		border-radius: 10px;
		padding: 12px;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.annotation-card:hover {
		border-color: #71717a;
	}

	.annotation-card.active {
		border-color: #2563eb;
		background: #1e293b;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}

	.card-badge {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		color: #ffffff;
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card-time {
		font-size: 11px;
		color: #a1a1aa;
		flex: 1;
	}

	.card-delete-btn {
		background: transparent;
		border: 0;
		color: #ef4444;
		font-size: 12px;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.card-delete-btn:hover {
		background: rgba(239, 68, 68, 0.15);
	}

	.card-body {
		margin: 0;
		font-size: 13px;
		color: #e4e4e7;
		line-height: 1.5;
		white-space: pre-wrap;
	}

	/* Toast Notice */
	.notice-toast {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		background: #27272a;
		color: #ffffff;
		border: 1px solid #3f3f46;
		padding: 8px 16px;
		border-radius: 999px;
		font-size: 13px;
		font-weight: 500;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
		z-index: 50;
		animation: fadeIn 0.2s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translate(-50%, 8px);
		}
		to {
			opacity: 1;
			transform: translate(-50%, 0);
		}
	}

	/* Mobile Adaptations */
	@media (max-width: 640px) {
		.top-header {
			padding: 0 10px;
		}
		.filename-row strong {
			max-width: 130px;
			font-size: 14px;
		}
		.meta-sub span:last-child {
			display: none;
		}
		.brush-toolbar {
			top: 62px;
			width: calc(100% - 16px);
			justify-content: space-between;
			padding: 6px 10px;
		}
		.image-wrapper {
			max-width: calc(100vw - 16px);
			max-height: calc(100dvh - 120px);
		}
		.image-wrapper img {
			max-width: calc(100vw - 16px);
			max-height: calc(100dvh - 120px);
		}
		.nav-arrow {
			width: 36px;
			height: 48px;
			font-size: 22px;
		}
		.nav-arrow.left {
			left: 6px;
		}
		.nav-arrow.right {
			right: 6px;
		}
		.composer-drawer {
			bottom: 12px;
			padding: 12px;
		}
	}
</style>
