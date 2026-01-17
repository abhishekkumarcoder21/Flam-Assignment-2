/**
 * canvasManager.ts - Mouse/touch event handling for canvas
 * 
 * RESPONSIBILITY: Input handling and local drawing
 * - Capture mouse/touch events
 * - Throttle via requestAnimationFrame
 * - Update local canvas optimistically
 * - Emit events to socket layer
 * 
 * KEY DESIGN: requestAnimationFrame throttling
 * - Mouse can poll at 1000Hz on gaming mice
 * - We batch points per frame (~60Hz) for network efficiency
 * - This reduces WebSocket messages by ~16x
 */

import { Stroke, Point, DrawingSettings, createPoint, User } from './stroke';
import { drawStroke, drawStrokeIncremental, redrawCanvas, clearCanvas, drawCursors } from './redraw';

type CanvasEventCallbacks = {
    onStrokeStart: (tool: 'brush' | 'eraser', color: string, width: number) => void;
    onStrokeUpdate: (strokeId: string, points: Point[]) => void;
    onStrokeEnd: (strokeId: string) => void;
    onCursorMove: (x: number, y: number) => void;
};

/**
 * CanvasManager handles all canvas input and local rendering.
 */
export class CanvasManager {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;

    // Separate canvas layer for cursors (avoids redrawing strokes on cursor move)
    private cursorCanvas: HTMLCanvasElement;
    private cursorCtx: CanvasRenderingContext2D;

    // Current drawing state
    private isDrawing = false;
    private currentStrokeId: string | null = null;
    private currentStroke: Stroke | null = null;
    private settings: DrawingSettings = {
        tool: 'brush',
        color: '#000000',
        width: 5
    };

    // Point batching for throttling
    private pendingPoints: Point[] = [];
    private rafId: number | null = null;
    private lastPointCount = 0;

    // Cursor throttling
    private lastCursorEmit = 0;
    private cursorThrottleMs = 50; // Emit cursor at most every 50ms

    // External event callbacks
    private callbacks: CanvasEventCallbacks;

    // State from server
    private strokes: Map<string, Stroke> = new Map();
    private users: User[] = [];
    private currentUserId: string | null = null;

    constructor(canvas: HTMLCanvasElement, cursorCanvas: HTMLCanvasElement, callbacks: CanvasEventCallbacks) {
        this.canvas = canvas;
        this.cursorCanvas = cursorCanvas;
        this.callbacks = callbacks;

        // Get 2D context (non-null assertion safe here - we control canvas creation)
        const ctx = canvas.getContext('2d');
        const cursorCtx = cursorCanvas.getContext('2d');
        if (!ctx || !cursorCtx) {
            throw new Error('Failed to get canvas 2D context');
        }
        this.ctx = ctx;
        this.cursorCtx = cursorCtx;

        // Initialize canvas
        this.resizeCanvas();
        clearCanvas(this.ctx);

        // Bind event listeners
        this.bindEvents();

        // Handle window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    /**
     * Resize canvas to fill window while maintaining resolution.
     */
    private resizeCanvas(): void {
        const dpr = window.devicePixelRatio || 1;
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Set display size
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.cursorCanvas.style.width = `${width}px`;
        this.cursorCanvas.style.height = `${height}px`;

        // Set actual size (accounting for device pixel ratio for crisp lines)
        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.cursorCanvas.width = width * dpr;
        this.cursorCanvas.height = height * dpr;

        // Scale context to account for DPR
        this.ctx.scale(dpr, dpr);
        this.cursorCtx.scale(dpr, dpr);

        // Redraw after resize
        this.redrawAll();
    }

    /**
     * Bind mouse and touch event listeners.
     */
    private bindEvents(): void {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e.offsetX, e.offsetY));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e.offsetX, e.offsetY, e.buttons === 1));
        this.canvas.addEventListener('mouseup', () => this.handlePointerUp());
        this.canvas.addEventListener('mouseleave', () => this.handlePointerUp());

        // Touch events (for tablets/phones)
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            this.handlePointerDown(touch.clientX - rect.left, touch.clientY - rect.top);
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            this.handlePointerMove(touch.clientX - rect.left, touch.clientY - rect.top, true);
        }, { passive: false });

        this.canvas.addEventListener('touchend', () => this.handlePointerUp());
    }

    /**
     * Handle pointer down (start drawing).
     */
    private handlePointerDown(x: number, y: number): void {
        this.isDrawing = true;
        this.pendingPoints = [];
        this.lastPointCount = 0;

        // Create local stroke for optimistic rendering
        this.currentStroke = {
            id: 'temp_' + Date.now(), // Temporary ID until server confirms
            userId: this.currentUserId || '',
            tool: this.settings.tool,
            color: this.settings.color,
            width: this.settings.width,
            points: [createPoint(x, y)],
            complete: false
        };

        // Draw the first point immediately
        drawStroke(this.ctx, this.currentStroke);

        // Notify socket layer to emit STROKE_START
        this.callbacks.onStrokeStart(this.settings.tool, this.settings.color, this.settings.width);
    }

    /**
     * Handle pointer move (continue drawing).
     */
    private handlePointerMove(x: number, y: number, isDrawingActive: boolean): void {
        // Always emit cursor position (throttled)
        const now = Date.now();
        if (now - this.lastCursorEmit > this.cursorThrottleMs) {
            this.callbacks.onCursorMove(x, y);
            this.lastCursorEmit = now;
        }

        // Only add points if actively drawing
        if (!isDrawingActive || !this.isDrawing || !this.currentStroke) return;

        // Add point to pending batch
        const point = createPoint(x, y);
        this.pendingPoints.push(point);
        this.currentStroke.points.push(point);

        // Draw locally immediately (optimistic)
        drawStrokeIncremental(this.ctx, this.currentStroke, this.lastPointCount);
        this.lastPointCount = this.currentStroke.points.length;

        // Schedule batch send via requestAnimationFrame
        if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
                this.flushPendingPoints();
            });
        }
    }

    /**
     * Flush pending points to server (batched via rAF).
     */
    private flushPendingPoints(): void {
        this.rafId = null;

        if (this.pendingPoints.length > 0 && this.currentStrokeId) {
            this.callbacks.onStrokeUpdate(this.currentStrokeId, [...this.pendingPoints]);
            this.pendingPoints = [];
        }
    }

    /**
     * Handle pointer up (end drawing).
     */
    private handlePointerUp(): void {
        if (!this.isDrawing) return;

        this.isDrawing = false;

        // Flush any remaining points
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.flushPendingPoints();

        // Mark stroke complete
        if (this.currentStrokeId) {
            this.callbacks.onStrokeEnd(this.currentStrokeId);
        }

        // Store completed stroke
        if (this.currentStroke && this.currentStrokeId) {
            this.currentStroke.id = this.currentStrokeId;
            this.currentStroke.complete = true;
            this.strokes.set(this.currentStrokeId, this.currentStroke);
        }

        this.currentStroke = null;
        this.currentStrokeId = null;
    }

    /**
     * Set the stroke ID assigned by server after STROKE_START.
     */
    setCurrentStrokeId(strokeId: string): void {
        this.currentStrokeId = strokeId;

        // Flush any points that accumulated while waiting for ID
        if (this.pendingPoints.length > 0) {
            this.callbacks.onStrokeUpdate(strokeId, [...this.pendingPoints]);
            this.pendingPoints = [];
        }
    }

    /**
     * Handle remote STROKE_START (another user started drawing).
     */
    handleRemoteStrokeStart(strokeId: string, userId: string, tool: 'brush' | 'eraser', color: string, width: number): void {
        const stroke: Stroke = {
            id: strokeId,
            userId,
            tool,
            color,
            width,
            points: [],
            complete: false
        };
        this.strokes.set(strokeId, stroke);
    }

    /**
     * Handle remote STROKE_UPDATE (another user added points).
     */
    handleRemoteStrokeUpdate(strokeId: string, points: Point[]): void {
        const stroke = this.strokes.get(strokeId);
        if (!stroke) return;

        const previousCount = stroke.points.length;
        stroke.points.push(...points);

        // Draw incrementally for performance
        drawStrokeIncremental(this.ctx, stroke, previousCount);
    }

    /**
     * Handle remote STROKE_END (another user finished drawing).
     */
    handleRemoteStrokeEnd(strokeId: string): void {
        const stroke = this.strokes.get(strokeId);
        if (stroke) {
            stroke.complete = true;
        }
    }

    /**
     * Sync state from server (on join or undo/redo).
     */
    syncState(strokes: Stroke[], users: User[], currentUserId: string): void {
        this.strokes.clear();
        for (const stroke of strokes) {
            this.strokes.set(stroke.id, stroke);
        }
        this.users = users;
        this.currentUserId = currentUserId;
        this.redrawAll();
    }

    /**
     * Update visible strokes after undo/redo.
     */
    updateVisibleStrokes(visibleStrokes: Stroke[]): void {
        this.strokes.clear();
        for (const stroke of visibleStrokes) {
            this.strokes.set(stroke.id, stroke);
        }
        this.redrawAll();
    }

    /**
     * Redraw all strokes on canvas.
     */
    redrawAll(): void {
        redrawCanvas(this.ctx, Array.from(this.strokes.values()));
        this.redrawCursors();
    }

    /**
     * Update and redraw remote user cursors.
     */
    updateCursor(userId: string, x: number, y: number): void {
        const user = this.users.find(u => u.id === userId);
        if (user) {
            user.cursor = { x, y };
            this.redrawCursors();
        }
    }

    /**
     * Redraw cursor layer.
     */
    private redrawCursors(): void {
        // Clear cursor canvas
        this.cursorCtx.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);

        // Draw all cursors
        if (this.currentUserId) {
            drawCursors(this.cursorCtx, this.users, this.currentUserId);
        }
    }

    /**
     * Update drawing settings.
     */
    setSettings(settings: Partial<DrawingSettings>): void {
        Object.assign(this.settings, settings);
    }

    /**
     * Get current drawing settings.
     */
    getSettings(): DrawingSettings {
        return { ...this.settings };
    }

    /**
     * Update user list.
     */
    setUsers(users: User[]): void {
        this.users = users;
        this.redrawCursors();
    }

    /**
     * Add a new user.
     */
    addUser(user: User): void {
        this.users.push(user);
        this.redrawCursors();
    }

    /**
     * Remove a user.
     */
    removeUser(userId: string): void {
        this.users = this.users.filter(u => u.id !== userId);
        this.redrawCursors();
    }
}
