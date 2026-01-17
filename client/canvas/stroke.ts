/**
 * stroke.ts - Type definitions for strokes and operations
 * 
 * RESPONSIBILITY: Single source of truth for data types
 * Shared across all client modules to ensure consistency.
 */

// A single point in a stroke with timestamp for ordering
export type Point = {
    x: number;
    y: number;
    t: number; // Timestamp - useful for replay and latency measurement
};

// A complete stroke with all metadata
export type Stroke = {
    id: string;
    userId: string;
    tool: 'brush' | 'eraser';
    color: string;
    width: number;
    points: Point[];
    complete: boolean;
};

// Tool selection
export type Tool = 'brush' | 'eraser';

// Drawing settings controlled by toolbar
export type DrawingSettings = {
    tool: Tool;
    color: string;
    width: number;
};

// User representation for display
export type User = {
    id: string;
    name: string;
    color: string;
    cursor: { x: number; y: number } | null;
};

// Operation types (mirror server-side for consistency)
export type Operation =
    | { type: 'stroke'; strokeId: string; timestamp: number; userId: string }
    | { type: 'undo'; targetStrokeId: string; timestamp: number; userId: string; id: string }
    | { type: 'redo'; targetUndoOpId: string; timestamp: number; userId: string; id: string };

/**
 * Create a new point from mouse/touch event
 */
export function createPoint(x: number, y: number): Point {
    return { x, y, t: Date.now() };
}

/**
 * Calculate distance between two points
 * Used for smoothing and point deduplication
 */
export function pointDistance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
}
