<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { formatFileSize } from '$lib/review/fileSize';

	interface Props {
		data: {
			kind: 'ppt';
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

	type PptAnnotation = {
		id: string;
		slideIndex: number;
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

	let viewer = $state<any>(null);
	let currentIndex = $state(0); // 0-indexed slide
	let totalSlides = $state(1);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	let slideWidth = $state(960);
	let slideHeight = $state(540); // default 16:9

	/** Quarter-turn read mode for landscape slides on a portrait screen. */
	let rotated = $state(false);

	// Annotation mode
	let annotationMode = $state(false);
	let brushColor = $state('#ef4444');
	let brushSize = $state(6);
	let isDrawing = $state(false);
	let currentStroke = $state<Stroke | null>(null);
	let draftStrokes = $state<Stroke[]>([]);
	let draftComment = $state('');

	let annotations = $state<PptAnnotation[]>([]);
	let currentAnnotations = $derived(annotations.filter((ann) => ann.slideIndex === currentIndex));
	let totalAnnotationCount = $derived(annotations.length);

	let selectedAnnotationId = $state<string | null>(null);
	let showListModal = $state(false);
	let notice = $state('');
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	let slideContainer = $state<HTMLDivElement | null>(null);
	let drawingCanvas = $state<HTMLCanvasElement | null>(null);
	let wrapperElement = $state<HTMLDivElement | null>(null);
	let stageElement = $state<HTMLElement | null>(null);
	let composerTextarea = $state<HTMLTextAreaElement | null>(null);

	// Zoom & Pan state
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	let isPinching = $state(false);
	let isPanning = $state(false);
	let isMousePanning = $state(false);
	let isSpacePressed = $state(false);
	let isAnimating = $state(false);

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

	const storageKey = $derived(`reviewloop:live-ppt:${data.token}`);

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

		loadPresentation();

		window.addEventListener('resize', handleResize);

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
			if (viewer) {
				try {
					viewer.destroy();
				} catch {}
			}
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

	async function loadPresentation() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(data.src);
			if (!res.ok) throw new Error(`无法获取文件 (HTTP ${res.status})`);
			const buffer = await res.arrayBuffer();

			if (!slideContainer) return;
			slideContainer.innerHTML = '';

			const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import('@aiden0z/pptx-renderer');

			viewer = await PptxViewer.open(buffer, slideContainer, {
				fitMode: 'contain',
				renderMode: 'slide',
				zipLimits: RECOMMENDED_ZIP_LIMITS
			});

			totalSlides = Math.max(1, viewer.slideCount || 1);
			calculateSlideDimensions();
			await viewer.renderSlide(currentIndex);

			isLoading = false;
			await tick();
			syncCanvas();
		} catch (err: any) {
			console.error('Failed to load PPT presentation:', err);
			isLoading = false;
			loadError = err?.message || '无法解析该幻灯片文件';
		}
	}

	function calculateSlideDimensions() {
		const viewW = stageElement?.clientWidth || window.innerWidth;
		const viewH = (stageElement?.clientHeight || window.innerHeight) - 40;

		// When rotated the slide's on-screen footprint has its width and height
		// swapped, so fit the aspect ratio against a swapped viewport.
		const stageW = rotated ? viewH : viewW;
		const stageH = rotated ? viewW : viewH;

		const nativeW = viewer?.slideWidth || 960;
		const nativeH = viewer?.slideHeight || 540;
		const aspectRatio = nativeW / nativeH;

		let targetW = stageW - 48;
		let targetH = targetW / aspectRatio;

		if (targetH > stageH - 48) {
			targetH = stageH - 48;
			targetW = targetH * aspectRatio;
		}

		slideWidth = Math.max(320, Math.floor(targetW));
		slideHeight = Math.max(180, Math.floor(targetH));
	}

	/**
	 * A 16:9 slide fitted into a portrait phone fills about a quarter of the
	 * screen. Turning it a quarter turn fills roughly all of it -- about four
	 * times the area -- which is the difference between readable and not.
	 */
	function toggleRotation() {
		rotated = !rotated;
		resetZoom(false);
		calculateSlideDimensions();
		tick().then(syncCanvas);
	}

	/** Only worth offering when turning the slide would actually gain area. */
	let rotationHelps = $derived.by(() => {
		void slideWidth;
		void slideHeight;
		const viewW = stageElement?.clientWidth || 0;
		const viewH = (stageElement?.clientHeight || 0) - 40;
		if (viewW <= 0 || viewH <= 0) return false;
		const slideAspect = (viewer?.slideWidth || 960) / (viewer?.slideHeight || 540);
		// Landscape content in a portrait viewport.
		return slideAspect > 1 && viewH > viewW;
	});

	function handleResize() {
		calculateSlideDimensions();
		syncCanvas();
	}

	// The drawing canvas is mounted lazily by {#if annotationMode}, so every
	// syncCanvas() call made while annotation mode is off is a no-op. Re-sync
	// once the element exists, and whenever the slide is resized underneath it.
	$effect(() => {
		if (annotationMode && drawingCanvas) {
			void slideWidth;
			void slideHeight;
			syncCanvas();
		}
	});

	function syncCanvas() {
		if (!drawingCanvas) return;
		const dpr = window.devicePixelRatio || 1;
		drawingCanvas.width = Math.floor(slideWidth * dpr);
		drawingCanvas.height = Math.floor(slideHeight * dpr);
		drawingCanvas.style.width = `${slideWidth}px`;
		drawingCanvas.style.height = `${slideHeight}px`;
		redrawDraftCanvas();
	}

	async function goToSlide(idx: number) {
		if (idx >= 0 && idx < totalSlides && idx !== currentIndex) {
			if (draftStrokes.length > 0 && !confirm('当前绘制的画笔标注尚未保存，切换幻灯片将丢弃，是否继续？')) {
				return;
			}
			cancelDraft();
			resetZoom(false);
			currentIndex = idx;
			selectedAnnotationId = null;

			if (viewer) {
				try {
					await viewer.renderSlide(idx);
				} catch (err) {
					console.error('Error rendering slide:', err);
				}
			}
			await tick();
			syncCanvas();
		}
	}

	function goToNext() {
		if (currentIndex < totalSlides - 1) goToSlide(currentIndex + 1);
	}

	function goToPrev() {
		if (currentIndex > 0) goToSlide(currentIndex - 1);
	}

	function persistAnnotations(next: PptAnnotation[]) {
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
		const baseW = slideWidth || 600;
		const baseH = slideHeight || 400;
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
		} else if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
			event.preventDefault();
			goToNext();
		} else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
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
					clampPan();
				}
			}
		} else if (isPanning && e.touches.length === 1) {
			e.preventDefault();
			const currentX = e.touches[0].clientX;
			const currentY = e.touches[0].clientY;
			const dx = currentX - lastTouchPos.x;
			const dy = currentY - lastTouchPos.y;
			panX += dx;
			panY += dy;
			lastTouchPos = { x: currentX, y: currentY };
			clampPan();
		}
	}

	function handleStageTouchEnd(e: TouchEvent) {
		if (isPinching && e.touches.length < 2) {
			isPinching = false;
			if (zoom <= 1.05) resetZoom(true);
		}
		if (isPanning && e.touches.length === 0) {
			isPanning = false;
			clampPan();
		}

		if (!annotationMode && zoom <= 1.05 && e.touches.length === 0 && e.changedTouches.length === 1) {
			const touchEndX = e.changedTouches[0].clientX;
			const touchEndY = e.changedTouches[0].clientY;
			const dx = touchEndX - touchStartX;
			const dy = touchEndY - touchStartY;
			const dt = Date.now() - touchStartTime;
			if (dt < 400 && Math.abs(dx) > 60 && Math.abs(dy) < 80) {
				if (dx < 0) goToNext();
				else goToPrev();
			}
		}
	}

	function handleWheel(e: WheelEvent) {
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const zoomFactor = Math.exp(-e.deltaY * 0.008);
			applyZoomAtPoint(zoom * zoomFactor, e.clientX, e.clientY);
		} else if (zoom > 1.02) {
			e.preventDefault();
			panX -= e.deltaX;
			panY -= e.deltaY;
			clampPan();
		}
	}

	function handleStageMouseDown(e: MouseEvent) {
		if (e.button === 1 || (e.button === 0 && isSpacePressed)) {
			isMousePanning = true;
			lastMousePos = { x: e.clientX, y: e.clientY };
			e.preventDefault();
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

	function handleStageMouseUp(e: MouseEvent) {
		if (isMousePanning) {
			isMousePanning = false;
			clampPan();
		}
	}

	function handleStageDblClick(e: MouseEvent) {
		if (annotationMode && isDrawing) return;
		checkDoubleTap(e.clientX, e.clientY);
	}

	// Canvas drawing logic
	function getNormalizedPoint(e: PointerEvent): Point | null {
		const target = drawingCanvas;
		if (!target) return null;
		const rect = target.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;

		let x: number;
		let y: number;
		if (rotated) {
			// getBoundingClientRect() is axis-aligned, so under rotate(90deg) it
			// describes the turned footprint and its axes no longer match the
			// slide's. Invert the quarter turn: slide (0,0) lands at the top
			// right of that box, so screen Y drives slide X and screen X drives
			// slide Y backwards.
			x = (e.clientY - rect.top) / rect.height;
			y = 1 - (e.clientX - rect.left) / rect.width;
		} else {
			x = (e.clientX - rect.left) / rect.width;
			y = (e.clientY - rect.top) / rect.height;
		}

		return {
			x: Math.max(0, Math.min(1, x)),
			y: Math.max(0, Math.min(1, y))
		};
	}

	function handlePointerDown(e: PointerEvent) {
		if (!annotationMode || isPinching || isSpacePressed || e.button !== 0 || !drawingCanvas) return;
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
		if (isPinching || isSpacePressed || !isDrawing || !currentStroke || !drawingCanvas) return;
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
		if (!drawingCanvas || !currentStroke || currentStroke.points.length < 2) return;
		const ctx = drawingCanvas.getContext('2d');
		if (!ctx) return;

		const baseW = slideWidth;
		const baseH = slideHeight;
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
		const baseW = slideWidth;
		const baseH = slideHeight;
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

	function cancelDraft() {
		draftStrokes = [];
		draftComment = '';
		currentStroke = null;
		redrawDraftCanvas();
	}

	function saveDraftAnnotation() {
		if (draftStrokes.length === 0) return null;
		const firstPoint = draftStrokes[0].points[0] ?? { x: 0.5, y: 0.5 };
		const annotation: PptAnnotation = {
			id: crypto.randomUUID(),
			slideIndex: currentIndex,
			strokes: draftStrokes,
			badgePosition: {
				x: Math.min(0.95, Math.max(0.05, firstPoint.x)),
				y: Math.min(0.95, Math.max(0.05, firstPoint.y))
			},
			body: draftComment.trim(),
			createdAt: new Date().toISOString()
		};

		const next = [...annotations, annotation];
		persistAnnotations(next);
		selectedAnnotationId = annotation.id;
		cancelDraft();
		showNotice('已保存标注');
		return annotation;
	}

	function deleteAnnotation(id: string) {
		const next = annotations.filter((ann) => ann.id !== id);
		persistAnnotations(next);
		if (selectedAnnotationId === id) selectedAnnotationId = null;
		showNotice('已删除标注');
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

	async function exportAnnotatedSlide() {
		try {
			showNotice('正在导出标注...');
			const baseW = slideWidth;
			const baseH = slideHeight;
			const dpr = 2;

			const canvas = document.createElement('canvas');
			canvas.width = baseW * dpr;
			canvas.height = baseH * dpr;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Cannot get canvas context');

			ctx.scale(dpr, dpr);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, baseW, baseH);

			// Draw saved annotations
			for (let i = 0; i < currentAnnotations.length; i++) {
				const ann = currentAnnotations[i];
				for (const stroke of ann.strokes) {
					if (stroke.points.length === 0) continue;
					ctx.strokeStyle = stroke.color;
					ctx.lineWidth = stroke.size;
					ctx.lineCap = 'round';
					ctx.lineJoin = 'round';
					ctx.beginPath();
					ctx.moveTo(stroke.points[0].x * baseW, stroke.points[0].y * baseH);
					for (let k = 1; k < stroke.points.length; k++) {
						const p0 = stroke.points[k - 1];
						const p1 = stroke.points[k];
						const midX = ((p0.x + p1.x) / 2) * baseW;
						const midY = ((p0.y + p1.y) / 2) * baseH;
						ctx.quadraticCurveTo(p0.x * baseW, p0.y * baseH, midX, midY);
					}
					const last = stroke.points[stroke.points.length - 1];
					ctx.lineTo(last.x * baseW, last.y * baseH);
					ctx.stroke();
				}

				const bx = ann.badgePosition.x * baseW;
				const by = ann.badgePosition.y * baseH;
				ctx.save();
				ctx.fillStyle = '#ef4444';
				ctx.beginPath();
				ctx.arc(bx, by, 14, 0, Math.PI * 2);
				ctx.fill();
				ctx.lineWidth = 2;
				ctx.strokeStyle = '#ffffff';
				ctx.stroke();
				ctx.fillStyle = '#ffffff';
				ctx.font = 'bold 12px sans-serif';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(String(i + 1), bx, by);
				ctx.restore();
			}

			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
			if (!blob) throw new Error('Export failed');

			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `${data.filename.replace(/\.pptx?$/i, '')}-slide-${currentIndex + 1}-annotated.png`;
			a.click();
			URL.revokeObjectURL(url);
			showNotice('标注已导出');
		} catch (err: any) {
			console.error('Export error:', err);
			showNotice('导出失败: ' + (err?.message || '未知错误'));
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} onkeyup={handleKeyup} />

<svelte:head>
	<title>{data.filename} (第 {currentIndex + 1} / {totalSlides} 页) · Live PowerPoint Review</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="ppt-review-container">
	<!-- Top Navigation & Toolbar -->
	<header class="ppt-header">
		<div class="file-meta">
			<span class="file-icon">📊</span>
			<div class="file-text">
				<strong class="file-name" title={data.filename}>{data.filename}</strong>
				<span class="file-sub">PowerPoint · {formatFileSize(data.size)} · 共 {totalSlides} 页</span>
			</div>
		</div>

		<!-- Slide Nav Controls -->
		<div class="slide-nav-controls">
			<button
				type="button"
				class="nav-btn"
				onclick={goToPrev}
				disabled={currentIndex === 0 || isLoading}
				title="上一页 (Left Arrow / PageUp)"
			>
				‹
			</button>
			<div class="slide-nav-pill">
				<span>第</span>
				<input
					type="number"
					min="1"
					max={totalSlides}
					value={currentIndex + 1}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
							if (!isNaN(val)) goToSlide(val - 1);
						}
					}}
					onblur={(e) => {
						const val = parseInt(e.currentTarget.value, 10);
						if (!isNaN(val)) goToSlide(val - 1);
					}}
				/>
				<span>/ {totalSlides} 页</span>
			</div>
			<button
				type="button"
				class="nav-btn"
				onclick={goToNext}
				disabled={currentIndex >= totalSlides - 1 || isLoading}
				title="下一页 (Right Arrow / PageDown / Space)"
			>
				›
			</button>
		</div>

		<!-- Right Actions Toolbar -->
		<div class="toolbar-actions">
			{#if annotationMode}
				<div class="brush-palette" role="toolbar" aria-label="画笔调色盘">
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
						onclick={cancelDraft}
						disabled={draftStrokes.length === 0}
						title="清空未保存画笔"
					>
						✕
					</button>
				</div>
			{/if}

			{#if rotationHelps}
				<button
					class="tool-btn"
					class:active={rotated}
					type="button"
					onclick={toggleRotation}
					title={rotated ? '恢复正向显示' : '横向显示，充分利用竖屏空间'}
				>
					<span class="btn-icon">⟳</span>
					<span class="btn-label-desktop">{rotated ? '恢复方向' : '横向铺满'}</span>
				</button>
			{/if}

			<button
				class="tool-btn"
				class:active={annotationMode}
				type="button"
				onclick={() => {
					annotationMode = !annotationMode;
					if (!annotationMode && draftStrokes.length > 0) cancelDraft();
				}}
			>
				<span class="btn-icon">🎨</span>
				<span>{annotationMode ? '退出标注' : '画笔标注'}</span>
			</button>

			<button
				class="tool-btn badge-btn"
				type="button"
				onclick={() => (showListModal = true)}
				title="查看所有标注"
			>
				<span class="btn-icon">💬</span>
				<span>标注 ({totalAnnotationCount})</span>
			</button>

			<button
				class="tool-btn export-btn"
				type="button"
				onclick={exportAnnotatedSlide}
				disabled={isLoading}
				title="导出当前幻灯片及标注为 PNG"
			>
				<span class="btn-icon">📥</span>
				<span class="btn-label-desktop">导出当前页</span>
			</button>
		</div>
	</header>

	<!-- Main Presentation Stage -->
	<main
		class="ppt-stage"
		class:drawing-mode={annotationMode}
		class:space-grabbing={isSpacePressed}
		bind:this={stageElement}
	>
		{#if isLoading}
			<div class="loading-overlay">
				<div class="spinner"></div>
				<p>正在载入演示文稿与幻灯片资源...</p>
			</div>
		{:else if loadError}
			<div class="error-overlay">
				<span class="error-icon">⚠️</span>
				<p>{loadError}</p>
				<button class="retry-btn" onclick={loadPresentation}>重新加载</button>
			</div>
		{/if}

		<div
			class="slide-viewport-wrapper"
			class:animating={isAnimating}
			bind:this={wrapperElement}
			style="transform: translate3d({panX}px, {panY}px, 0) scale({zoom}){rotated
				? ' rotate(90deg)'
				: ''}; width: {slideWidth}px; height: {slideHeight}px;"
		>
			<!-- PptxViewer Mount Container -->
			<div
				bind:this={slideContainer}
				class="slide-render-mount"
				style="width: {slideWidth}px; height: {slideHeight}px;"
			></div>

			<!-- Saved Vector SVG Annotations -->
			<svg
				class="annotations-svg"
				viewBox="0 0 {slideWidth} {slideHeight}"
				xmlns="http://www.w3.org/2000/svg"
			>
				{#each currentAnnotations as ann, annIndex (ann.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<g
						class="annotation-group"
						class:selected={selectedAnnotationId === ann.id}
						role="button"
						tabindex="0"
						onclick={(e) => {
							e.stopPropagation();
							selectedAnnotationId = selectedAnnotationId === ann.id ? null : ann.id;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter') selectedAnnotationId = ann.id;
						}}
					>
						{#each ann.strokes as stroke}
							<path
								d={strokesToSvgPath(stroke, slideWidth, slideHeight)}
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
							transform="translate({ann.badgePosition.x * slideWidth}, {ann.badgePosition.y * slideHeight})"
						>
							<circle r="14" class="badge-bg" />
							<text y="4" text-anchor="middle" class="badge-number">{annIndex + 1}</text>
						</g>
					</g>
				{/each}
			</svg>

			<!-- Drawing Canvas Layer -->
			{#if annotationMode}
				<canvas
					bind:this={drawingCanvas}
					class="drawing-canvas"
					onpointerdown={handlePointerDown}
					onpointermove={handlePointerMove}
					onpointerup={handlePointerUp}
					onpointercancel={handlePointerCancel}
				></canvas>
			{/if}
		</div>

		<!-- Nav Arrows -->
		{#if currentIndex > 0 && !annotationMode}
			<button
				type="button"
				class="nav-arrow left"
				onclick={goToPrev}
				title="上一页 (Left Arrow / PageUp)"
			>
				‹
			</button>
		{/if}
		{#if currentIndex < totalSlides - 1 && !annotationMode}
			<button
				type="button"
				class="nav-arrow right"
				onclick={goToNext}
				title="下一页 (Right Arrow / PageDown / Space)"
			>
				›
			</button>
		{/if}

		<!-- Floating Zoom Controls Pill -->
		<div class="zoom-controls">
			<button
				type="button"
				class="zoom-btn"
				onclick={() => applyZoomDelta(-0.5)}
				disabled={zoom <= 1.02}
				title="缩小 (-)"
			>
				-
			</button>
			<button
				type="button"
				class="zoom-level-btn"
				onclick={() => resetZoom(true)}
				title="重置为 100% (快捷键 0)"
			>
				{Math.round(zoom * 100)}%
			</button>
			<button
				type="button"
				class="zoom-btn"
				onclick={() => applyZoomDelta(0.5)}
				disabled={zoom >= 5}
				title="放大 (+)"
			>
				+
			</button>
			{#if zoom > 1.05}
				<button type="button" class="zoom-reset-btn" onclick={() => resetZoom(true)} title="复位">
					重置
				</button>
			{/if}
		</div>
	</main>

	<!-- Draft Comment Composer Popup -->
	{#if draftStrokes.length > 0}
		<div class="composer-popup">
			<div class="composer-header">
				<span class="composer-title">✏️ 新建画笔标注</span>
				<span class="composer-sub">已绘制 {draftStrokes.length} 笔</span>
			</div>
			<textarea
				bind:this={composerTextarea}
				bind:value={draftComment}
				placeholder="填写关于该幻灯片的意见或批注..."
				rows="3"
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						saveDraftAnnotation();
					} else if (e.key === 'Escape') {
						e.preventDefault();
						cancelDraft();
					}
				}}
			></textarea>
			<div class="composer-actions">
				<button type="button" class="btn-secondary" onclick={cancelDraft}>放弃</button>
				<button type="button" class="btn-primary" onclick={saveDraftAnnotation}>保存标注</button>
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
						<span class="detail-badge">
							第 {selectedAnn.slideIndex + 1} 页
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
				<p class="detail-body">
					{selectedAnn.body || '（无附注文字）'}
				</p>
				<div class="detail-footer">
					<button
						type="button"
						class="delete-ann-btn"
						onclick={() => deleteAnnotation(selectedAnn.id)}
					>
						删除此标注
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
			<div class="modal-content" role="dialog" aria-modal="true" aria-label="全部幻灯片标注">
				<div class="modal-header">
					<h3>全部幻灯片标注 ({totalAnnotationCount})</h3>
					<button type="button" class="close-btn" onclick={() => (showListModal = false)}>✕</button>
				</div>
				<div class="modal-body">
					{#if annotations.length === 0}
						<div class="empty-list">
							<p>暂无任何标注。开启上方「画笔标注」即可在幻灯片上绘制圈选！</p>
						</div>
					{:else}
						<div class="ann-list">
							{#each annotations as ann, idx (ann.id)}
								<div class="ann-item" class:is-current-slide={ann.slideIndex === currentIndex}>
									<div class="ann-item-header">
										<span class="ann-item-badge">#{idx + 1} 第 {ann.slideIndex + 1} 页</span>
										<span class="ann-item-time">{new Date(ann.createdAt).toLocaleString()}</span>
									</div>
									<p class="ann-item-text">{ann.body || '（画笔圈注，未填写附注）'}</p>
									<div class="ann-item-actions">
										<button
											type="button"
											class="btn-jump"
											onclick={() => {
												goToSlide(ann.slideIndex);
												selectedAnnotationId = ann.id;
												showListModal = false;
											}}
										>
											跳转到该页
										</button>
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
	.ppt-review-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		background: #09090b;
		color: #f4f4f5;
		overflow: hidden;
		user-select: none;
		position: relative;
	}

	/* Top Header */
	.ppt-header {
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

	.ppt-header button {
		white-space: nowrap;
	}

	.file-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		/* Filename is the only thing allowed to give way; controls keep
		   their intrinsic width so labels never compress to one glyph
		   per line and render as vertical strips. */
		flex: 1 1 auto;
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
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Slide Navigation */
	.slide-nav-controls {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}

	.nav-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.08);
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: #ffffff;
		font-size: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.15s;
	}

	.nav-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.16);
	}

	.nav-btn:disabled {
		opacity: 0.2;
		cursor: not-allowed;
	}

	.slide-nav-pill {
		display: flex;
		align-items: center;
		gap: 4px;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 6px;
		padding: 2px 8px;
		font-size: 12px;
		color: #d4d4d8;
	}

	.slide-nav-pill input {
		width: 38px;
		background: transparent;
		border: none;
		color: #ffffff;
		font-size: 12px;
		font-weight: 600;
		text-align: center;
		outline: none;
	}

	/* Right Actions */
	.toolbar-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
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

	/* Stage */
	.ppt-stage {
		flex: 1;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #141416;
	}

	.ppt-stage.drawing-mode {
		cursor: crosshair;
	}

	.ppt-stage.space-grabbing {
		cursor: grab;
	}

	.slide-viewport-wrapper {
		position: relative;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
		/* .ppt-stage is a flex row, so a slide laid out wider than the stage
		   gets shrunk back to the stage width. That is exactly the rotated
		   case: the slide is sized against the swapped viewport and is meant
		   to overflow horizontally before the rotation turns it upright. */
		flex-shrink: 0;
		transform-origin: center center;
		will-change: transform;
		background: #ffffff;
		overflow: hidden;
		border-radius: 4px;
	}

	.slide-viewport-wrapper.animating {
		transition: transform 0.25s cubic-bezier(0.2, 0, 0, 1);
	}

	.slide-render-mount {
		position: relative;
		overflow: hidden;
		background: #ffffff;
	}

	/* Force rendered pptx slides to fill container */
	:global(.slide-render-mount > *) {
		width: 100% !important;
		height: 100% !important;
	}

	.annotations-svg {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
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

	.drawing-canvas {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		cursor: crosshair;
		touch-action: none;
		z-index: 20;
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
		z-index: 25;
		cursor: pointer;
	}

	.nav-arrow:hover {
		background: rgba(39, 39, 42, 0.9);
		transform: translateY(-50%) scale(1.08);
	}

	.nav-arrow.left {
		left: 14px;
	}

	.nav-arrow.right {
		right: 14px;
	}

	/* Zoom Controls */
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
		z-index: 25;
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
		cursor: pointer;
	}

	.zoom-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.15);
		color: #fff;
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
		cursor: pointer;
	}

	.zoom-level-btn:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.zoom-reset-btn {
		height: 24px;
		padding: 0 8px;
		background: rgba(59, 130, 246, 0.2);
		border: 1px solid rgba(59, 130, 246, 0.4);
		border-radius: 999px;
		color: #93c5fd;
		font-size: 11px;
		cursor: pointer;
	}

	/* Composer Popup */
	.composer-popup {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		width: 90%;
		max-width: 420px;
		background: rgba(24, 24, 27, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 12px;
		padding: 14px;
		box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(16px);
		z-index: 35;
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

	.composer-sub {
		font-size: 11px;
		color: #a1a1aa;
	}

	.composer-popup textarea {
		width: 100%;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.4);
		border: 1px solid rgba(255, 255, 255, 0.1);
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

	/* Detail Card */
	.detail-card {
		position: absolute;
		top: 68px;
		right: 16px;
		width: 280px;
		background: rgba(24, 24, 27, 0.95);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 10px;
		padding: 12px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(14px);
		z-index: 35;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}

	.detail-badge {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
		font-size: 11px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 4px;
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

	/* Modal */
	.modal-wrapper {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
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

	.ann-item.is-current-slide {
		border-color: rgba(59, 130, 246, 0.4);
		background: rgba(59, 130, 246, 0.05);
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

	.ann-item-time {
		font-size: 11px;
		color: #71717a;
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

	.btn-jump {
		background: rgba(59, 130, 246, 0.2);
		border: 1px solid rgba(59, 130, 246, 0.3);
		color: #93c5fd;
		border-radius: 4px;
		padding: 3px 8px;
		font-size: 11px;
		cursor: pointer;
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
		z-index: 60;
		pointer-events: none;
	}

	@media (max-width: 640px) {
		.btn-label-desktop {
			display: none;
		}
		/* The floating edge arrows overlap the page on a narrow screen and
		   there is nothing to gain from them: the header carries prev/next
		   and a horizontal swipe already changes page. */
		.nav-arrow {
			display: none;
		}
		/* One 56px row cannot hold the filename plus every control on a
		   phone, so let the header grow into rows: file identity on the
		   first, controls on the second, and controls scroll sideways
		   rather than compress if they still do not fit. */
		.ppt-header {
			height: auto;
			flex-wrap: wrap;
			align-items: flex-start;
			row-gap: 8px;
			padding: 8px 12px;
		}
		.file-meta {
			flex: 1 1 100%;
		}
		.file-name {
			max-width: none;
		}
		.slide-nav-controls,
		.toolbar-actions {
			max-width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.slide-nav-controls::-webkit-scrollbar,
		.toolbar-actions::-webkit-scrollbar {
			display: none;
		}
	}
</style>
