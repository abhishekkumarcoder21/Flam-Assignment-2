/**
 * server.ts - Main server entry point
 * 
 * RESPONSIBILITY: Bootstrap only
 * - Initialize Express for static file serving
 * - Initialize Socket.io with CORS
 * - Wire up room manager and socket handlers
 * 
 * WHY EXPRESS: Serves client files without separate web server.
 * WHY SOCKET.IO: Provides WebSocket abstraction with fallbacks.
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { RoomManager } from './rooms';
import { registerSocketHandlers } from './socketHandlers';

const PORT = process.env.PORT || 3000;

// Initialize Express app
const app = express();
const httpServer = createServer(app);

// Initialize Socket.io with CORS for development
const io = new Server(httpServer, {
    cors: {
        origin: '*', // Allow all origins in development
        methods: ['GET', 'POST']
    }
});

// Initialize room manager (shared across all connections)
const roomManager = new RoomManager();

// Serve static files from client directory
// Note: Using path.join to handle both dev and production paths
const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// Serve Socket.io client library (bundled with socket.io)
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// Handle new socket connections
io.on('connection', (socket) => {
    registerSocketHandlers(io, socket, roomManager);
});

// Start server
httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║         Collaborative Canvas Server Started                ║
╠════════════════════════════════════════════════════════════╣
║  Local:   http://localhost:${PORT}                           ║
║  Network: http://<your-ip>:${PORT}                           ║
║                                                            ║
║  Open multiple tabs to test collaboration!                 ║
╚════════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    io.close();
    httpServer.close(() => {
        console.log('[Server] Closed.');
        process.exit(0);
    });
});
