/**
 * socketClient.ts - WebSocket communication layer
 * 
 * RESPONSIBILITY: All network communication
 * - Connect to server
 * - Emit drawing events
 * - Handle incoming events
 * - Reconnection with state sync
 * 
 * DESIGN: Thin layer between canvas and server
 * No business logic here - just event marshalling.
 */

// Socket.io client is loaded via script tag, available as global `io`
// Minimal type definition for the Socket interface we use
interface Socket {
    connected: boolean;
    on(event: string, callback: (...args: any[]) => void): void;
    emit(event: string, data?: any): void;
    disconnect(): void;
}

declare const io: (url: string, options: any) => Socket;
import { Stroke, Point, User } from '../canvas/stroke';

export type SocketEventCallbacks = {
    // Connection events
    onConnected: (userId: string) => void;
    onDisconnected: () => void;

    // State sync
    onSyncState: (userId: string, users: User[], strokes: Stroke[]) => void;

    // User events
    onUserJoined: (user: User) => void;
    onUserLeft: (userId: string) => void;

    // Cursor events
    onCursorMove: (userId: string, x: number, y: number) => void;

    // Stroke events
    onStrokeStarted: (strokeId: string) => void; // Confirmation of our stroke
    onRemoteStrokeStart: (strokeId: string, userId: string, tool: 'brush' | 'eraser', color: string, width: number) => void;
    onRemoteStrokeUpdate: (strokeId: string, points: Point[]) => void;
    onRemoteStrokeEnd: (strokeId: string) => void;

    // Undo/redo events
    onUndo: (userId: string, targetStrokeId: string, visibleStrokes: Stroke[]) => void;
    onRedo: (userId: string, targetUndoOpId: string, visibleStrokes: Stroke[]) => void;
    onCanvasCleared: (userId: string, visibleStrokes: Stroke[]) => void;
};

/**
 * SocketClient manages the WebSocket connection to the server.
 */
export class SocketClient {
    private socket: Socket;
    private callbacks: SocketEventCallbacks;
    private currentUserId: string | null = null;

    constructor(serverUrl: string, callbacks: SocketEventCallbacks) {
        this.callbacks = callbacks;

        // Connect to server
        this.socket = io(serverUrl, {
            transports: ['websocket'], // Use WebSocket directly, skip long-polling
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000
        });

        this.bindEvents();
    }

    /**
     * Bind all socket event handlers.
     */
    private bindEvents(): void {
        // Connection events
        this.socket.on('connect', () => {
            console.log('[Socket] Connected to server');
            // Join default room on connect
            this.joinRoom('main');
        });

        this.socket.on('disconnect', () => {
            console.log('[Socket] Disconnected from server');
            this.callbacks.onDisconnected();
        });

        // State sync on join
        this.socket.on('SYNC_STATE', (data: {
            userId: string;
            users: User[];
            strokes: Stroke[];
        }) => {
            console.log('[Socket] Received state sync:', data.strokes.length, 'strokes');
            this.currentUserId = data.userId;
            this.callbacks.onConnected(data.userId);
            this.callbacks.onSyncState(data.userId, data.users, data.strokes);
        });

        // User events
        this.socket.on('USER_JOINED', (data: { user: User }) => {
            console.log('[Socket] User joined:', data.user.name);
            this.callbacks.onUserJoined(data.user);
        });

        this.socket.on('USER_LEFT', (data: { userId: string }) => {
            console.log('[Socket] User left:', data.userId);
            this.callbacks.onUserLeft(data.userId);
        });

        // Cursor events
        this.socket.on('CURSOR_MOVE', (data: { userId: string; x: number; y: number }) => {
            this.callbacks.onCursorMove(data.userId, data.x, data.y);
        });

        // Stroke start confirmation (for our own strokes)
        this.socket.on('STROKE_STARTED', (data: { strokeId: string }) => {
            console.log('[Socket] Stroke started with ID:', data.strokeId);
            this.callbacks.onStrokeStarted(data.strokeId);
        });

        // Remote stroke events (from other users)
        this.socket.on('STROKE_START', (data: {
            strokeId: string;
            userId: string;
            tool: 'brush' | 'eraser';
            color: string;
            width: number;
        }) => {
            this.callbacks.onRemoteStrokeStart(
                data.strokeId,
                data.userId,
                data.tool,
                data.color,
                data.width
            );
        });

        this.socket.on('STROKE_UPDATE', (data: { strokeId: string; points: Point[] }) => {
            this.callbacks.onRemoteStrokeUpdate(data.strokeId, data.points);
        });

        this.socket.on('STROKE_END', (data: { strokeId: string }) => {
            this.callbacks.onRemoteStrokeEnd(data.strokeId);
        });

        // Undo/redo events
        this.socket.on('UNDO', (data: {
            userId: string;
            targetStrokeId: string;
            undoOpId: string;
            visibleStrokes: Stroke[];
        }) => {
            console.log('[Socket] Undo:', data.targetStrokeId);
            this.callbacks.onUndo(data.userId, data.targetStrokeId, data.visibleStrokes);
        });

        this.socket.on('REDO', (data: {
            userId: string;
            targetUndoOpId: string;
            visibleStrokes: Stroke[];
        }) => {
            console.log('[Socket] Redo:', data.targetUndoOpId);
            this.callbacks.onRedo(data.userId, data.targetUndoOpId, data.visibleStrokes);
        });

        this.socket.on('CANVAS_CLEARED', (data: {
            userId: string;
            visibleStrokes: Stroke[];
        }) => {
            console.log('[Socket] Canvas cleared by:', data.userId);
            this.callbacks.onCanvasCleared(data.userId, data.visibleStrokes);
        });
    }

    /**
     * Join a room.
     */
    joinRoom(roomId: string, userName?: string): void {
        this.socket.emit('JOIN_ROOM', { roomId, userName });
    }

    /**
     * Emit cursor position.
     */
    emitCursorMove(x: number, y: number): void {
        this.socket.emit('CURSOR_MOVE', { x, y });
    }

    /**
     * Start a new stroke.
     */
    emitStrokeStart(tool: 'brush' | 'eraser', color: string, width: number): void {
        this.socket.emit('STROKE_START', { tool, color, width });
    }

    /**
     * Send stroke point updates.
     */
    emitStrokeUpdate(strokeId: string, points: Point[]): void {
        this.socket.emit('STROKE_UPDATE', { strokeId, points });
    }

    /**
     * End current stroke.
     */
    emitStrokeEnd(strokeId: string): void {
        this.socket.emit('STROKE_END', { strokeId });
    }

    /**
     * Request undo (own last stroke if no target specified).
     */
    emitUndo(targetStrokeId?: string): void {
        this.socket.emit('UNDO', { targetStrokeId });
    }

    /**
     * Request redo (own last undo if no target specified).
     */
    emitRedo(targetUndoOpId?: string): void {
        this.socket.emit('REDO', { targetUndoOpId });
    }

    /**
     * Clear canvas (undo all strokes).
     */
    emitClearCanvas(): void {
        this.socket.emit('CLEAR_CANVAS');
    }

    /**
     * Get current user ID.
     */
    getCurrentUserId(): string | null {
        return this.currentUserId;
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.socket.connected;
    }

    /**
     * Disconnect from server.
     */
    disconnect(): void {
        this.socket.disconnect();
    }
}
