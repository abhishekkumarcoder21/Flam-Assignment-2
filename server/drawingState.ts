/**
 * drawingState.ts - Server-side drawing state management
 * 
 * ARCHITECTURE DECISION: Operation-based state model
 * - All changes are stored as operations in an ordered list
 * - Undo/redo append new operations (never delete)
 * - Visibility is computed by replaying operations
 * - This ensures conflict-free cross-user undo/redo
 */

import { v4 as uuidv4 } from 'uuid';

// Core data types matching the specification
export type Point = { x: number; y: number; t: number };

export type Stroke = {
    id: string;
    userId: string;
    tool: 'brush' | 'eraser';
    color: string;
    width: number;
    points: Point[];
    complete: boolean; // Marks if stroke is finished (mouseup received)
};

// Operation types for the append-only log
export type Operation =
    | { type: 'stroke'; strokeId: string; timestamp: number; userId: string }
    | { type: 'undo'; targetStrokeId: string; timestamp: number; userId: string; id: string }
    | { type: 'redo'; targetUndoOpId: string; timestamp: number; userId: string; id: string };

/**
 * DrawingState manages the authoritative state for a single room.
 * 
 * WHY THIS DESIGN:
 * 1. Strokes are stored separately from operations for efficient point updates
 * 2. Operations form an append-only log for undo/redo
 * 3. getVisibleStrokes() computes current state by replaying ops
 * 4. No mutation of existing data = no race conditions
 */
export class DrawingState {
    // Map of strokeId -> Stroke data
    private strokes: Map<string, Stroke> = new Map();

    // Ordered list of all operations (append-only)
    private operations: Operation[] = [];

    /**
     * Create a new stroke and register it in the operation log.
     * Called on STROKE_START event.
     */
    createStroke(
        userId: string,
        tool: 'brush' | 'eraser',
        color: string,
        width: number
    ): Stroke {
        const id = uuidv4();
        const timestamp = Date.now();

        const stroke: Stroke = {
            id,
            userId,
            tool,
            color,
            width,
            points: [],
            complete: false
        };

        this.strokes.set(id, stroke);
        this.operations.push({ type: 'stroke', strokeId: id, timestamp, userId });

        return stroke;
    }

    /**
     * Append points to an existing stroke.
     * Called on STROKE_UPDATE event.
     * 
     * WHY SEPARATE FROM createStroke:
     * - Allows streaming points during drawing
     * - Client can show stroke incrementally while user draws
     * - Reduces perceived latency significantly
     */
    appendPoints(strokeId: string, points: Point[]): boolean {
        const stroke = this.strokes.get(strokeId);
        if (!stroke) return false;

        stroke.points.push(...points);
        return true;
    }

    /**
     * Mark a stroke as complete.
     * Called on STROKE_END event.
     */
    completeStroke(strokeId: string): boolean {
        const stroke = this.strokes.get(strokeId);
        if (!stroke) return false;

        stroke.complete = true;
        return true;
    }

    /**
     * Undo a specific stroke by adding an undo operation.
     * 
     * CRITICAL: We don't delete the stroke!
     * - Appending an undo op makes the stroke invisible
     * - Redo can later cancel the undo
     * - Cross-user undo works because server orders all operations
     * 
     * Returns the undo operation ID (needed for redo).
     */
    undoStroke(userId: string, targetStrokeId: string): string | null {
        // Verify stroke exists and is currently visible
        const stroke = this.strokes.get(targetStrokeId);
        if (!stroke) return null;

        // Check if stroke is already undone
        if (!this.isStrokeVisible(targetStrokeId)) return null;

        const undoId = uuidv4();
        const undoOp: Operation = {
            type: 'undo',
            id: undoId,
            targetStrokeId,
            timestamp: Date.now(),
            userId
        };

        this.operations.push(undoOp);
        return undoId;
    }

    /**
     * Redo by canceling an undo operation.
     * 
     * We find the matching undo op and add a redo op that references it.
     */
    redoStroke(userId: string, targetUndoOpId: string): boolean {
        // Find the undo operation
        const undoOp = this.operations.find(
            op => op.type === 'undo' && op.id === targetUndoOpId
        );
        if (!undoOp) return false;

        // Check if this undo is not already re-done
        const alreadyRedone = this.operations.some(
            op => op.type === 'redo' && op.targetUndoOpId === targetUndoOpId
        );
        if (alreadyRedone) return false;

        const redoOp: Operation = {
            type: 'redo',
            id: uuidv4(),
            targetUndoOpId,
            timestamp: Date.now(),
            userId
        };

        this.operations.push(redoOp);
        return true;
    }

    /**
     * Check if a stroke is currently visible.
     * A stroke is visible if:
     * 1. It exists
     * 2. There's no unmatched undo operation for it
     */
    private isStrokeVisible(strokeId: string): boolean {
        let undoCount = 0;
        let redoCount = 0;

        for (const op of this.operations) {
            if (op.type === 'undo' && op.targetStrokeId === strokeId) {
                undoCount++;
            } else if (op.type === 'redo') {
                // Find matching undo to see if it's for this stroke
                const matchingUndo = this.operations.find(
                    o => o.type === 'undo' && o.id === op.targetUndoOpId
                );
                if (matchingUndo && matchingUndo.type === 'undo' &&
                    matchingUndo.targetStrokeId === strokeId) {
                    redoCount++;
                }
            }
        }

        // Visible if redos balance out undos
        return undoCount <= redoCount;
    }

    /**
     * Get all currently visible strokes.
     * 
     * PERFORMANCE NOTE:
     * This is O(operations * undos) in worst case.
     * For typical usage (<1000 strokes), this is negligible.
     * For production, could cache visibility state and invalidate on undo/redo.
     */
    getVisibleStrokes(): Stroke[] {
        const result: Stroke[] = [];

        for (const [strokeId, stroke] of this.strokes) {
            if (this.isStrokeVisible(strokeId)) {
                result.push(stroke);
            }
        }

        // Return in operation order for consistent rendering
        const strokeOrder = this.operations
            .filter(op => op.type === 'stroke')
            .map(op => op.strokeId);

        result.sort((a, b) =>
            strokeOrder.indexOf(a.id) - strokeOrder.indexOf(b.id)
        );

        return result;
    }

    /**
     * Get the most recent stroke ID for a user.
     * Used for undo (allows user to undo their own last stroke easily).
     */
    getLastVisibleStrokeByUser(userId: string): string | null {
        const visibleStrokes = this.getVisibleStrokes()
            .filter(s => s.userId === userId && s.complete);

        return visibleStrokes.length > 0
            ? visibleStrokes[visibleStrokes.length - 1].id
            : null;
    }

    /**
     * Get the most recent undo operation ID for a user.
     * Used for redo.
     */
    getLastUndoByUser(userId: string): string | null {
        // Get all undo ops by this user that haven't been re-done
        const undoOps = this.operations.filter(op => {
            if (op.type !== 'undo' || op.userId !== userId) return false;

            // Check if not already re-done
            const redoneBy = this.operations.find(
                o => o.type === 'redo' && o.targetUndoOpId === op.id
            );
            return !redoneBy;
        });

        return undoOps.length > 0
            ? (undoOps[undoOps.length - 1] as any).id
            : null;
    }

    /**
     * Get a stroke by ID.
     */
    getStroke(strokeId: string): Stroke | undefined {
        return this.strokes.get(strokeId);
    }

    /**
     * Get full state for sync (new user joins).
     */
    getFullState(): { strokes: Stroke[]; operations: Operation[] } {
        return {
            strokes: Array.from(this.strokes.values()),
            operations: [...this.operations]
        };
    }
}
