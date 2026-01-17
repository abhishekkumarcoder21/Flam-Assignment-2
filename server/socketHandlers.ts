/**
 * socketHandlers.ts - WebSocket event handlers
 * 
 * RESPONSIBILITY: Handle all WebSocket events
 * - Validate incoming payloads
 * - Update state via drawingState and rooms
 * - Broadcast changes to room members
 * 
 * EVENT DESIGN RATIONALE:
 * - STROKE_START/UPDATE/END split enables real-time streaming
 * - CURSOR_MOVE separate for throttling (less critical than strokes)
 * - UNDO/REDO as explicit operations (not just state mutations)
 */

import { Server, Socket } from 'socket.io';
import { RoomManager, Room, User } from './rooms';
import { DrawingState, Stroke, Point } from './drawingState';

// Store drawing state per room
const roomStates: Map<string, DrawingState> = new Map();

function getOrCreateState(roomId: string): DrawingState {
    let state = roomStates.get(roomId);
    if (!state) {
        state = new DrawingState();
        roomStates.set(roomId, state);
    }
    return state;
}

/**
 * Register all socket handlers for a connection.
 */
export function registerSocketHandlers(
    io: Server,
    socket: Socket,
    roomManager: RoomManager
): void {
    let currentRoom: Room | null = null;
    let currentUser: User | null = null;
    let activeStrokeId: string | null = null; // Track the user's current stroke

    console.log(`[Socket] New connection: ${socket.id}`);

    /**
     * JOIN_ROOM - User joins a drawing room
     * Payload: { roomId?: string, userName?: string }
     */
    socket.on('JOIN_ROOM', (payload: { roomId?: string; userName?: string }) => {
        const roomId = payload.roomId || 'main';
        const userName = payload.userName || `Guest_${socket.id.substring(0, 4)}`;

        // Leave any previous room
        if (currentRoom) {
            socket.leave(currentRoom.id);
            currentRoom.removeUser(socket.id);
        }

        // Join new room
        currentRoom = roomManager.getOrCreateRoom(roomId);
        currentUser = currentRoom.addUser(socket.id, userName);
        socket.join(roomId);

        console.log(`[Socket] ${currentUser.name} joined room: ${roomId}`);

        // Get drawing state for this room
        const state = getOrCreateState(roomId);

        // Send current state to the joining user
        socket.emit('SYNC_STATE', {
            userId: currentUser.id,
            users: currentRoom.getAllUsers(),
            strokes: state.getVisibleStrokes(),
            fullState: state.getFullState() // For undo/redo reconstruction
        });

        // Notify others in room
        socket.to(roomId).emit('USER_JOINED', {
            user: currentUser
        });
    });

    /**
     * CURSOR_MOVE - User moved their cursor
     * Payload: { x: number, y: number }
     * 
     * Note: Should be throttled on client (e.g., 50ms)
     */
    socket.on('CURSOR_MOVE', (payload: { x: number; y: number }) => {
        if (!currentRoom || !currentUser) return;

        currentRoom.updateCursor(socket.id, payload.x, payload.y);

        // Broadcast to others (not back to sender)
        socket.to(currentRoom.id).emit('CURSOR_MOVE', {
            userId: currentUser.id,
            x: payload.x,
            y: payload.y
        });
    });

    /**
     * STROKE_START - User began drawing a new stroke
     * Payload: { tool: 'brush'|'eraser', color: string, width: number }
     * 
     * Returns stroke ID for client to track updates
     */
    socket.on('STROKE_START', (payload: {
        tool: 'brush' | 'eraser';
        color: string;
        width: number
    }) => {
        if (!currentRoom || !currentUser) return;

        const state = getOrCreateState(currentRoom.id);

        // Create the stroke server-side (authoritative)
        const stroke = state.createStroke(
            currentUser.id,
            payload.tool,
            payload.color,
            payload.width
        );

        activeStrokeId = stroke.id;

        // Confirm to sender with authoritative stroke ID
        socket.emit('STROKE_STARTED', { strokeId: stroke.id });

        // Broadcast to others
        socket.to(currentRoom.id).emit('STROKE_START', {
            strokeId: stroke.id,
            userId: currentUser.id,
            tool: payload.tool,
            color: payload.color,
            width: payload.width
        });

        console.log(`[Socket] ${currentUser.name} started stroke: ${stroke.id}`);
    });

    /**
     * STROKE_UPDATE - User added points to their current stroke
     * Payload: { strokeId: string, points: Point[] }
     * 
     * Points are batched by client (via requestAnimationFrame)
     */
    socket.on('STROKE_UPDATE', (payload: { strokeId: string; points: Point[] }) => {
        if (!currentRoom || !currentUser) return;
        if (!payload.strokeId || !payload.points || payload.points.length === 0) return;

        const state = getOrCreateState(currentRoom.id);

        // Append points to existing stroke
        const success = state.appendPoints(payload.strokeId, payload.points);
        if (!success) {
            console.warn(`[Socket] Failed to append points to stroke: ${payload.strokeId}`);
            return;
        }

        // Broadcast to others
        socket.to(currentRoom.id).emit('STROKE_UPDATE', {
            strokeId: payload.strokeId,
            points: payload.points
        });
    });

    /**
     * STROKE_END - User finished drawing a stroke
     * Payload: { strokeId: string }
     */
    socket.on('STROKE_END', (payload: { strokeId: string }) => {
        if (!currentRoom || !currentUser) return;
        if (!payload.strokeId) return;

        const state = getOrCreateState(currentRoom.id);
        state.completeStroke(payload.strokeId);

        activeStrokeId = null;

        // Broadcast to others
        socket.to(currentRoom.id).emit('STROKE_END', {
            strokeId: payload.strokeId
        });

        console.log(`[Socket] ${currentUser.name} completed stroke: ${payload.strokeId}`);
    });

    /**
     * UNDO - User wants to undo a stroke
     * Payload: { targetStrokeId?: string }
     * 
     * If no targetStrokeId provided, undo user's last visible stroke.
     * If targetStrokeId provided, undo that specific stroke (cross-user undo).
     */
    socket.on('UNDO', (payload: { targetStrokeId?: string }) => {
        if (!currentRoom || !currentUser) return;

        const state = getOrCreateState(currentRoom.id);

        // Determine which stroke to undo
        const targetId = payload.targetStrokeId || state.getLastVisibleStrokeByUser(currentUser.id);

        if (!targetId) {
            console.log(`[Socket] ${currentUser.name} has nothing to undo`);
            return;
        }

        // Perform the undo
        const undoOpId = state.undoStroke(currentUser.id, targetId);
        if (!undoOpId) {
            console.log(`[Socket] Failed to undo stroke: ${targetId}`);
            return;
        }

        console.log(`[Socket] ${currentUser.name} undid stroke: ${targetId}`);

        // Broadcast to ALL users in room (including sender for confirmation)
        io.to(currentRoom.id).emit('UNDO', {
            userId: currentUser.id,
            targetStrokeId: targetId,
            undoOpId: undoOpId,
            visibleStrokes: state.getVisibleStrokes() // Send updated visible strokes
        });
    });

    /**
     * REDO - User wants to redo an undo
     * Payload: { targetUndoOpId?: string }
     * 
     * If no targetUndoOpId provided, redo user's last undo.
     */
    socket.on('REDO', (payload: { targetUndoOpId?: string }) => {
        if (!currentRoom || !currentUser) return;

        const state = getOrCreateState(currentRoom.id);

        // Determine which undo to redo
        const targetUndoId = payload.targetUndoOpId || state.getLastUndoByUser(currentUser.id);

        if (!targetUndoId) {
            console.log(`[Socket] ${currentUser.name} has nothing to redo`);
            return;
        }

        // Perform the redo
        const success = state.redoStroke(currentUser.id, targetUndoId);
        if (!success) {
            console.log(`[Socket] Failed to redo: ${targetUndoId}`);
            return;
        }

        console.log(`[Socket] ${currentUser.name} redid undo: ${targetUndoId}`);

        // Broadcast to ALL users in room
        io.to(currentRoom.id).emit('REDO', {
            userId: currentUser.id,
            targetUndoOpId: targetUndoId,
            visibleStrokes: state.getVisibleStrokes()
        });
    });

    /**
     * CLEAR_CANVAS - Clear all strokes (undo all)
     * This is a convenience operation, implemented as multiple undos
     */
    socket.on('CLEAR_CANVAS', () => {
        if (!currentRoom || !currentUser) return;

        const state = getOrCreateState(currentRoom.id);
        const visibleStrokes = state.getVisibleStrokes();

        // Undo all visible strokes
        for (const stroke of visibleStrokes) {
            state.undoStroke(currentUser.id, stroke.id);
        }

        console.log(`[Socket] ${currentUser.name} cleared canvas (undid ${visibleStrokes.length} strokes)`);

        // Broadcast updated state
        io.to(currentRoom.id).emit('CANVAS_CLEARED', {
            userId: currentUser.id,
            visibleStrokes: state.getVisibleStrokes()
        });
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
        if (currentRoom && currentUser) {
            console.log(`[Socket] ${currentUser.name} disconnected from room: ${currentRoom.id}`);

            currentRoom.removeUser(socket.id);

            // Notify others
            socket.to(currentRoom.id).emit('USER_LEFT', {
                userId: currentUser.id
            });

            // Clean up empty rooms
            roomManager.removeRoomIfEmpty(currentRoom.id);
        }
    });
}
