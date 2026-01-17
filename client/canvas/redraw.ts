/**
 * redraw.ts - Canvas rendering logic
 * 
 * RESPONSIBILITY: All canvas drawing operations
 * - Full canvas redraw (on undo/redo)
 * - Incremental stroke drawing (during active drawing)
 * 
 * PERFORMANCE STRATEGY:
 * 1. During drawing: Only draw new points (incremental)
 * 2. On undo/redo: Clear and redraw all visible strokes
 * 
 * WHY FULL REDRAW IS ACCEPTABLE:
 * - Drawing apps have sparse strokes (not millions of pixels)
 * - 1000 strokes × 100 points = ~100ms worst case
 * - Simpler than tracking dirty regions per undo
 */

import { Stroke, Point } from './stroke';

/**
 * Draw a single stroke on the canvas.
 * Uses quadratic curves for smooth lines.
 * 
 * @param ctx - Canvas 2D context
 * @param stroke - Stroke to draw
 * @param startIndex - Start from this point index (for incremental drawing)
 */
export function drawStroke(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    startIndex: number = 0
): void {
    const points = stroke.points;
    if (points.length < 2) {
        // Need at least 2 points to draw a line
        if (points.length === 1) {
            // Single point - draw a dot
            ctx.beginPath();
            ctx.fillStyle = stroke.tool === 'eraser' ? '#FFFFFF' : stroke.color;
            ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
            ctx.fill();
        }
        return;
    }

    ctx.beginPath();
    ctx.strokeStyle = stroke.tool === 'eraser' ? '#FFFFFF' : stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // For full stroke, start from beginning
    // For incremental, start from specified index
    const effectiveStart = Math.max(0, startIndex - 1);

    // Move to starting point
    if (effectiveStart === 0) {
        ctx.moveTo(points[0].x, points[0].y);
    } else {
        ctx.moveTo(points[effectiveStart].x, points[effectiveStart].y);
    }

    // Use quadratic curves for smooth lines
    // Each segment uses the midpoint between consecutive points as control point
    for (let i = effectiveStart + 1; i < points.length; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];

        // Midpoint for smoother curves
        const midX = (p0.x + p1.x) / 2;
        const midY = (p0.y + p1.y) / 2;

        ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }

    // Draw to the last point
    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);

    ctx.stroke();
}

/**
 * Draw only new points added to a stroke (incremental).
 * Called during active drawing for performance.
 * 
 * @param ctx - Canvas 2D context
 * @param stroke - Stroke being drawn
 * @param previousPointCount - Number of points before this batch
 */
export function drawStrokeIncremental(
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    previousPointCount: number
): void {
    // Draw only the new segment
    drawStroke(ctx, stroke, previousPointCount);
}

/**
 * Clear the entire canvas.
 */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Redraw all strokes on the canvas.
 * Called after undo/redo or when syncing state.
 * 
 * @param ctx - Canvas 2D context
 * @param strokes - All visible strokes to draw
 */
export function redrawCanvas(
    ctx: CanvasRenderingContext2D,
    strokes: Stroke[]
): void {
    // Clear first
    clearCanvas(ctx);

    // Draw all strokes in order
    for (const stroke of strokes) {
        drawStroke(ctx, stroke);
    }
}

/**
 * Draw user cursors on the canvas.
 * Each cursor is a colored circle with the user's name.
 * 
 * @param ctx - Canvas 2D context
 * @param users - All users with their cursor positions
 * @param currentUserId - Current user's ID (to skip their cursor)
 */
export function drawCursors(
    ctx: CanvasRenderingContext2D,
    users: Array<{ id: string; name: string; color: string; cursor: { x: number; y: number } | null }>,
    currentUserId: string
): void {
    for (const user of users) {
        // Skip current user and users without cursor position
        if (user.id === currentUserId || !user.cursor) continue;

        const { x, y } = user.cursor;

        // Draw cursor circle
        ctx.beginPath();
        ctx.fillStyle = user.color;
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fill();

        // Draw outer ring
        ctx.beginPath();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();

        // Draw user name label
        ctx.font = '12px Inter, system-ui, sans-serif';
        ctx.fillStyle = user.color;
        ctx.textAlign = 'left';
        ctx.fillText(user.name, x + 12, y + 4);
    }
}
