/**
 * main.ts - Client entry point
 * 
 * RESPONSIBILITY: Orchestration only
 * - Initialize all modules
 * - Wire up callbacks between modules
 * - No business logic here
 * 
 * This is the glue that connects canvas, socket, and UI.
 */

import { CanvasManager } from './canvas/canvasManager';
import { SocketClient } from './socket/socketClient';
import { Toolbar } from './ui/toolbar';
import { UserList } from './ui/userList';

/**
 * Main application initialization.
 */
function init(): void {
    console.log('[Main] Initializing Collaborative Canvas...');

    // Get DOM elements
    const canvas = document.getElementById('drawing-canvas') as HTMLCanvasElement;
    const cursorCanvas = document.getElementById('cursor-canvas') as HTMLCanvasElement;
    const toolbarContainer = document.getElementById('toolbar') as HTMLElement;
    const userListContainer = document.getElementById('user-list') as HTMLElement;

    if (!canvas || !cursorCanvas || !toolbarContainer || !userListContainer) {
        console.error('[Main] Required DOM elements not found');
        return;
    }

    // These will be set after socket connects
    let socketClient: SocketClient | null = null;

    // Initialize canvas manager with callbacks to socket
    const canvasManager = new CanvasManager(canvas, cursorCanvas, {
        onStrokeStart: (tool, color, width) => {
            socketClient?.emitStrokeStart(tool, color, width);
        },
        onStrokeUpdate: (strokeId, points) => {
            socketClient?.emitStrokeUpdate(strokeId, points);
        },
        onStrokeEnd: (strokeId) => {
            socketClient?.emitStrokeEnd(strokeId);
        },
        onCursorMove: (x, y) => {
            socketClient?.emitCursorMove(x, y);
        }
    });

    // Initialize user list
    const userList = new UserList(userListContainer);

    // Initialize toolbar with callbacks
    const toolbar = new Toolbar(toolbarContainer, {
        onSettingsChange: (settings) => {
            canvasManager.setSettings(settings);
        },
        onUndo: () => {
            socketClient?.emitUndo();
        },
        onRedo: () => {
            socketClient?.emitRedo();
        },
        onClear: () => {
            socketClient?.emitClearCanvas();
        }
    });

    // Set initial settings
    canvasManager.setSettings(toolbar.getSettings());

    // Initialize socket connection
    // For production: use your Render backend URL
    // For development: use localhost
    const BACKEND_URL = 'https://canvas-collaborate.onrender.com'; // Render backend URL
    const serverUrl = window.location.hostname === 'localhost'
        ? window.location.origin
        : BACKEND_URL;
    socketClient = new SocketClient(serverUrl, {
        onConnected: (userId) => {
            console.log('[Main] Connected as user:', userId);
            userList.setConnected(true);
        },
        onDisconnected: () => {
            console.log('[Main] Disconnected');
            userList.setConnected(false);
        },
        onSyncState: (userId, users, strokes) => {
            console.log('[Main] State synced:', strokes.length, 'strokes,', users.length, 'users');
            canvasManager.syncState(strokes, users, userId);
            userList.setCurrentUser(userId);
            userList.setUsers(users);
        },
        onUserJoined: (user) => {
            console.log('[Main] User joined:', user.name);
            userList.addUser(user);
            canvasManager.addUser(user);
        },
        onUserLeft: (userId) => {
            console.log('[Main] User left:', userId);
            userList.removeUser(userId);
            canvasManager.removeUser(userId);
        },
        onCursorMove: (userId, x, y) => {
            canvasManager.updateCursor(userId, x, y);
        },
        onStrokeStarted: (strokeId) => {
            canvasManager.setCurrentStrokeId(strokeId);
        },
        onRemoteStrokeStart: (strokeId, userId, tool, color, width) => {
            canvasManager.handleRemoteStrokeStart(strokeId, userId, tool, color, width);
        },
        onRemoteStrokeUpdate: (strokeId, points) => {
            canvasManager.handleRemoteStrokeUpdate(strokeId, points);
        },
        onRemoteStrokeEnd: (strokeId) => {
            canvasManager.handleRemoteStrokeEnd(strokeId);
        },
        onUndo: (userId, targetStrokeId, visibleStrokes) => {
            console.log('[Main] Undo received for stroke:', targetStrokeId);
            canvasManager.updateVisibleStrokes(visibleStrokes);
        },
        onRedo: (userId, targetUndoOpId, visibleStrokes) => {
            console.log('[Main] Redo received:', targetUndoOpId);
            canvasManager.updateVisibleStrokes(visibleStrokes);
        },
        onCanvasCleared: (userId, visibleStrokes) => {
            console.log('[Main] Canvas cleared by:', userId);
            canvasManager.updateVisibleStrokes(visibleStrokes);
        }
    });

    console.log('[Main] Initialization complete');
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
