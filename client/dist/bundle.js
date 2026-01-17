"use strict";
var App = (() => {
  // client/canvas/stroke.ts
  function createPoint(x, y) {
    return { x, y, t: Date.now() };
  }

  // client/canvas/redraw.ts
  function drawStroke(ctx, stroke, startIndex = 0) {
    const points = stroke.points;
    if (points.length < 2) {
      if (points.length === 1) {
        ctx.beginPath();
        ctx.fillStyle = stroke.tool === "eraser" ? "#FFFFFF" : stroke.color;
        ctx.arc(points[0].x, points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    ctx.beginPath();
    ctx.strokeStyle = stroke.tool === "eraser" ? "#FFFFFF" : stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const effectiveStart = Math.max(0, startIndex - 1);
    if (effectiveStart === 0) {
      ctx.moveTo(points[0].x, points[0].y);
    } else {
      ctx.moveTo(points[effectiveStart].x, points[effectiveStart].y);
    }
    for (let i = effectiveStart + 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      const midX = (p0.x + p1.x) / 2;
      const midY = (p0.y + p1.y) / 2;
      ctx.quadraticCurveTo(p0.x, p0.y, midX, midY);
    }
    const lastPoint = points[points.length - 1];
    ctx.lineTo(lastPoint.x, lastPoint.y);
    ctx.stroke();
  }
  function drawStrokeIncremental(ctx, stroke, previousPointCount) {
    drawStroke(ctx, stroke, previousPointCount);
  }
  function clearCanvas(ctx) {
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  function redrawCanvas(ctx, strokes) {
    clearCanvas(ctx);
    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }
  }
  function drawCursors(ctx, users, currentUserId) {
    for (const user of users) {
      if (user.id === currentUserId || !user.cursor)
        continue;
      const { x, y } = user.cursor;
      ctx.beginPath();
      ctx.fillStyle = user.color;
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillStyle = user.color;
      ctx.textAlign = "left";
      ctx.fillText(user.name, x + 12, y + 4);
    }
  }

  // client/canvas/canvasManager.ts
  var CanvasManager = class {
    constructor(canvas, cursorCanvas, callbacks) {
      // Current drawing state
      this.isDrawing = false;
      this.currentStrokeId = null;
      this.currentStroke = null;
      this.settings = {
        tool: "brush",
        color: "#000000",
        width: 5
      };
      // Point batching for throttling
      this.pendingPoints = [];
      this.rafId = null;
      this.lastPointCount = 0;
      // Cursor throttling
      this.lastCursorEmit = 0;
      this.cursorThrottleMs = 50;
      // State from server
      this.strokes = /* @__PURE__ */ new Map();
      this.users = [];
      this.currentUserId = null;
      this.canvas = canvas;
      this.cursorCanvas = cursorCanvas;
      this.callbacks = callbacks;
      const ctx = canvas.getContext("2d");
      const cursorCtx = cursorCanvas.getContext("2d");
      if (!ctx || !cursorCtx) {
        throw new Error("Failed to get canvas 2D context");
      }
      this.ctx = ctx;
      this.cursorCtx = cursorCtx;
      this.resizeCanvas();
      clearCanvas(this.ctx);
      this.bindEvents();
      window.addEventListener("resize", () => this.resizeCanvas());
    }
    /**
     * Resize canvas to fill window while maintaining resolution.
     */
    resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.cursorCanvas.style.width = `${width}px`;
      this.cursorCanvas.style.height = `${height}px`;
      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.cursorCanvas.width = width * dpr;
      this.cursorCanvas.height = height * dpr;
      this.ctx.scale(dpr, dpr);
      this.cursorCtx.scale(dpr, dpr);
      this.redrawAll();
    }
    /**
     * Bind mouse and touch event listeners.
     */
    bindEvents() {
      this.canvas.addEventListener("mousedown", (e) => this.handlePointerDown(e.offsetX, e.offsetY));
      this.canvas.addEventListener("mousemove", (e) => this.handlePointerMove(e.offsetX, e.offsetY, e.buttons === 1));
      this.canvas.addEventListener("mouseup", () => this.handlePointerUp());
      this.canvas.addEventListener("mouseleave", () => this.handlePointerUp());
      this.canvas.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        this.handlePointerDown(touch.clientX - rect.left, touch.clientY - rect.top);
      }, { passive: false });
      this.canvas.addEventListener("touchmove", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        this.handlePointerMove(touch.clientX - rect.left, touch.clientY - rect.top, true);
      }, { passive: false });
      this.canvas.addEventListener("touchend", () => this.handlePointerUp());
    }
    /**
     * Handle pointer down (start drawing).
     */
    handlePointerDown(x, y) {
      this.isDrawing = true;
      this.pendingPoints = [];
      this.lastPointCount = 0;
      this.currentStroke = {
        id: "temp_" + Date.now(),
        // Temporary ID until server confirms
        userId: this.currentUserId || "",
        tool: this.settings.tool,
        color: this.settings.color,
        width: this.settings.width,
        points: [createPoint(x, y)],
        complete: false
      };
      drawStroke(this.ctx, this.currentStroke);
      this.callbacks.onStrokeStart(this.settings.tool, this.settings.color, this.settings.width);
    }
    /**
     * Handle pointer move (continue drawing).
     */
    handlePointerMove(x, y, isDrawingActive) {
      const now = Date.now();
      if (now - this.lastCursorEmit > this.cursorThrottleMs) {
        this.callbacks.onCursorMove(x, y);
        this.lastCursorEmit = now;
      }
      if (!isDrawingActive || !this.isDrawing || !this.currentStroke)
        return;
      const point = createPoint(x, y);
      this.pendingPoints.push(point);
      this.currentStroke.points.push(point);
      drawStrokeIncremental(this.ctx, this.currentStroke, this.lastPointCount);
      this.lastPointCount = this.currentStroke.points.length;
      if (this.rafId === null) {
        this.rafId = requestAnimationFrame(() => {
          this.flushPendingPoints();
        });
      }
    }
    /**
     * Flush pending points to server (batched via rAF).
     */
    flushPendingPoints() {
      this.rafId = null;
      if (this.pendingPoints.length > 0 && this.currentStrokeId) {
        this.callbacks.onStrokeUpdate(this.currentStrokeId, [...this.pendingPoints]);
        this.pendingPoints = [];
      }
    }
    /**
     * Handle pointer up (end drawing).
     */
    handlePointerUp() {
      if (!this.isDrawing)
        return;
      this.isDrawing = false;
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.flushPendingPoints();
      if (this.currentStrokeId) {
        this.callbacks.onStrokeEnd(this.currentStrokeId);
      }
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
    setCurrentStrokeId(strokeId) {
      this.currentStrokeId = strokeId;
      if (this.pendingPoints.length > 0) {
        this.callbacks.onStrokeUpdate(strokeId, [...this.pendingPoints]);
        this.pendingPoints = [];
      }
    }
    /**
     * Handle remote STROKE_START (another user started drawing).
     */
    handleRemoteStrokeStart(strokeId, userId, tool, color, width) {
      const stroke = {
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
    handleRemoteStrokeUpdate(strokeId, points) {
      const stroke = this.strokes.get(strokeId);
      if (!stroke)
        return;
      const previousCount = stroke.points.length;
      stroke.points.push(...points);
      drawStrokeIncremental(this.ctx, stroke, previousCount);
    }
    /**
     * Handle remote STROKE_END (another user finished drawing).
     */
    handleRemoteStrokeEnd(strokeId) {
      const stroke = this.strokes.get(strokeId);
      if (stroke) {
        stroke.complete = true;
      }
    }
    /**
     * Sync state from server (on join or undo/redo).
     */
    syncState(strokes, users, currentUserId) {
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
    updateVisibleStrokes(visibleStrokes) {
      this.strokes.clear();
      for (const stroke of visibleStrokes) {
        this.strokes.set(stroke.id, stroke);
      }
      this.redrawAll();
    }
    /**
     * Redraw all strokes on canvas.
     */
    redrawAll() {
      redrawCanvas(this.ctx, Array.from(this.strokes.values()));
      this.redrawCursors();
    }
    /**
     * Update and redraw remote user cursors.
     */
    updateCursor(userId, x, y) {
      const user = this.users.find((u) => u.id === userId);
      if (user) {
        user.cursor = { x, y };
        this.redrawCursors();
      }
    }
    /**
     * Redraw cursor layer.
     */
    redrawCursors() {
      this.cursorCtx.clearRect(0, 0, this.cursorCanvas.width, this.cursorCanvas.height);
      if (this.currentUserId) {
        drawCursors(this.cursorCtx, this.users, this.currentUserId);
      }
    }
    /**
     * Update drawing settings.
     */
    setSettings(settings) {
      Object.assign(this.settings, settings);
    }
    /**
     * Get current drawing settings.
     */
    getSettings() {
      return { ...this.settings };
    }
    /**
     * Update user list.
     */
    setUsers(users) {
      this.users = users;
      this.redrawCursors();
    }
    /**
     * Add a new user.
     */
    addUser(user) {
      this.users.push(user);
      this.redrawCursors();
    }
    /**
     * Remove a user.
     */
    removeUser(userId) {
      this.users = this.users.filter((u) => u.id !== userId);
      this.redrawCursors();
    }
  };

  // client/socket/socketClient.ts
  var SocketClient = class {
    constructor(serverUrl, callbacks) {
      this.currentUserId = null;
      this.callbacks = callbacks;
      this.socket = io(serverUrl, {
        transports: ["websocket"],
        // Use WebSocket directly, skip long-polling
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1e3
      });
      this.bindEvents();
    }
    /**
     * Bind all socket event handlers.
     */
    bindEvents() {
      this.socket.on("connect", () => {
        console.log("[Socket] Connected to server");
        this.joinRoom("main");
      });
      this.socket.on("disconnect", () => {
        console.log("[Socket] Disconnected from server");
        this.callbacks.onDisconnected();
      });
      this.socket.on("SYNC_STATE", (data) => {
        console.log("[Socket] Received state sync:", data.strokes.length, "strokes");
        this.currentUserId = data.userId;
        this.callbacks.onConnected(data.userId);
        this.callbacks.onSyncState(data.userId, data.users, data.strokes);
      });
      this.socket.on("USER_JOINED", (data) => {
        console.log("[Socket] User joined:", data.user.name);
        this.callbacks.onUserJoined(data.user);
      });
      this.socket.on("USER_LEFT", (data) => {
        console.log("[Socket] User left:", data.userId);
        this.callbacks.onUserLeft(data.userId);
      });
      this.socket.on("CURSOR_MOVE", (data) => {
        this.callbacks.onCursorMove(data.userId, data.x, data.y);
      });
      this.socket.on("STROKE_STARTED", (data) => {
        console.log("[Socket] Stroke started with ID:", data.strokeId);
        this.callbacks.onStrokeStarted(data.strokeId);
      });
      this.socket.on("STROKE_START", (data) => {
        this.callbacks.onRemoteStrokeStart(
          data.strokeId,
          data.userId,
          data.tool,
          data.color,
          data.width
        );
      });
      this.socket.on("STROKE_UPDATE", (data) => {
        this.callbacks.onRemoteStrokeUpdate(data.strokeId, data.points);
      });
      this.socket.on("STROKE_END", (data) => {
        this.callbacks.onRemoteStrokeEnd(data.strokeId);
      });
      this.socket.on("UNDO", (data) => {
        console.log("[Socket] Undo:", data.targetStrokeId);
        this.callbacks.onUndo(data.userId, data.targetStrokeId, data.visibleStrokes);
      });
      this.socket.on("REDO", (data) => {
        console.log("[Socket] Redo:", data.targetUndoOpId);
        this.callbacks.onRedo(data.userId, data.targetUndoOpId, data.visibleStrokes);
      });
      this.socket.on("CANVAS_CLEARED", (data) => {
        console.log("[Socket] Canvas cleared by:", data.userId);
        this.callbacks.onCanvasCleared(data.userId, data.visibleStrokes);
      });
    }
    /**
     * Join a room.
     */
    joinRoom(roomId, userName) {
      this.socket.emit("JOIN_ROOM", { roomId, userName });
    }
    /**
     * Emit cursor position.
     */
    emitCursorMove(x, y) {
      this.socket.emit("CURSOR_MOVE", { x, y });
    }
    /**
     * Start a new stroke.
     */
    emitStrokeStart(tool, color, width) {
      this.socket.emit("STROKE_START", { tool, color, width });
    }
    /**
     * Send stroke point updates.
     */
    emitStrokeUpdate(strokeId, points) {
      this.socket.emit("STROKE_UPDATE", { strokeId, points });
    }
    /**
     * End current stroke.
     */
    emitStrokeEnd(strokeId) {
      this.socket.emit("STROKE_END", { strokeId });
    }
    /**
     * Request undo (own last stroke if no target specified).
     */
    emitUndo(targetStrokeId) {
      this.socket.emit("UNDO", { targetStrokeId });
    }
    /**
     * Request redo (own last undo if no target specified).
     */
    emitRedo(targetUndoOpId) {
      this.socket.emit("REDO", { targetUndoOpId });
    }
    /**
     * Clear canvas (undo all strokes).
     */
    emitClearCanvas() {
      this.socket.emit("CLEAR_CANVAS");
    }
    /**
     * Get current user ID.
     */
    getCurrentUserId() {
      return this.currentUserId;
    }
    /**
     * Check if connected.
     */
    isConnected() {
      return this.socket.connected;
    }
    /**
     * Disconnect from server.
     */
    disconnect() {
      this.socket.disconnect();
    }
  };

  // client/ui/toolbar.ts
  var PRESET_COLORS = [
    "#000000",
    // Black
    "#FFFFFF",
    // White
    "#FF6B6B",
    // Red
    "#4ECDC4",
    // Teal
    "#45B7D1",
    // Blue
    "#96CEB4",
    // Green
    "#FFEAA7",
    // Yellow
    "#DDA0DD"
    // Plum
  ];
  var Toolbar = class {
    constructor(container, callbacks) {
      // Current state
      this.currentTool = "brush";
      this.currentColor = "#000000";
      this.currentWidth = 5;
      this.container = container;
      this.callbacks = callbacks;
      this.createUI();
      this.bindEvents();
    }
    /**
     * Create toolbar HTML structure.
     */
    createUI() {
      this.container.innerHTML = `
      <div class="toolbar-section">
        <span class="toolbar-label">Tools</span>
        <button class="tool-btn active" id="brush-btn" title="Brush (B)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
            <circle cx="11" cy="11" r="2"/>
          </svg>
        </button>
        <button class="tool-btn" id="eraser-btn" title="Eraser (E)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 20H7L3 16c-.5-.5-.5-1.5 0-2l10-10c.5-.5 1.5-.5 2 0l7 7c.5.5.5 1.5 0 2l-6 6"/>
            <path d="M6 11l4 4"/>
          </svg>
        </button>
      </div>

      <div class="toolbar-section">
        <span class="toolbar-label">Color</span>
        <div class="color-presets">
          ${PRESET_COLORS.map((color) => `
            <button class="color-btn ${color === this.currentColor ? "active" : ""}" 
                    data-color="${color}" 
                    style="background-color: ${color}; ${color === "#FFFFFF" ? "border: 1px solid #ccc;" : ""}"
                    title="${color}">
            </button>
          `).join("")}
        </div>
        <input type="color" id="color-picker" value="${this.currentColor}" title="Custom color">
      </div>

      <div class="toolbar-section">
        <span class="toolbar-label">Size: <span id="width-display">${this.currentWidth}</span>px</span>
        <input type="range" id="width-slider" min="1" max="30" value="${this.currentWidth}">
      </div>

      <div class="toolbar-section toolbar-actions">
        <button class="action-btn" id="undo-btn" title="Undo (Ctrl+Z)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"/>
            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/>
          </svg>
          Undo
        </button>
        <button class="action-btn" id="redo-btn" title="Redo (Ctrl+Y)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 7v6h-6"/>
            <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/>
          </svg>
          Redo
        </button>
        <button class="action-btn danger" id="clear-btn" title="Clear canvas">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
          </svg>
          Clear
        </button>
      </div>
    `;
      this.brushBtn = document.getElementById("brush-btn");
      this.eraserBtn = document.getElementById("eraser-btn");
      this.colorPicker = document.getElementById("color-picker");
      this.widthSlider = document.getElementById("width-slider");
      this.widthDisplay = document.getElementById("width-display");
    }
    /**
     * Bind event listeners.
     */
    bindEvents() {
      this.brushBtn.addEventListener("click", () => this.setTool("brush"));
      this.eraserBtn.addEventListener("click", () => this.setTool("eraser"));
      const colorBtns = this.container.querySelectorAll(".color-btn");
      colorBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const color = btn.dataset.color;
          this.setColor(color);
        });
      });
      this.colorPicker.addEventListener("input", (e) => {
        this.setColor(e.target.value);
      });
      this.widthSlider.addEventListener("input", (e) => {
        const width = parseInt(e.target.value, 10);
        this.setWidth(width);
      });
      document.getElementById("undo-btn").addEventListener("click", () => {
        this.callbacks.onUndo();
      });
      document.getElementById("redo-btn").addEventListener("click", () => {
        this.callbacks.onRedo();
      });
      document.getElementById("clear-btn").addEventListener("click", () => {
        if (confirm("Clear the entire canvas? This can be undone.")) {
          this.callbacks.onClear();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT")
          return;
        if (e.key === "b" || e.key === "B") {
          this.setTool("brush");
        } else if (e.key === "e" || e.key === "E") {
          this.setTool("eraser");
        } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            this.callbacks.onRedo();
          } else {
            this.callbacks.onUndo();
          }
        } else if ((e.ctrlKey || e.metaKey) && e.key === "y") {
          e.preventDefault();
          this.callbacks.onRedo();
        }
      });
    }
    /**
     * Set current tool.
     */
    setTool(tool) {
      this.currentTool = tool;
      this.brushBtn.classList.toggle("active", tool === "brush");
      this.eraserBtn.classList.toggle("active", tool === "eraser");
      this.callbacks.onSettingsChange({ tool });
    }
    /**
     * Set current color.
     */
    setColor(color) {
      this.currentColor = color;
      this.colorPicker.value = color;
      const colorBtns = this.container.querySelectorAll(".color-btn");
      colorBtns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.color === color);
      });
      this.callbacks.onSettingsChange({ color });
    }
    /**
     * Set current width.
     */
    setWidth(width) {
      this.currentWidth = width;
      this.widthDisplay.textContent = String(width);
      this.widthSlider.value = String(width);
      this.callbacks.onSettingsChange({ width });
    }
    /**
     * Get current settings.
     */
    getSettings() {
      return {
        tool: this.currentTool,
        color: this.currentColor,
        width: this.currentWidth
      };
    }
  };

  // client/ui/userList.ts
  var UserList = class {
    constructor(container) {
      this.users = [];
      this.currentUserId = null;
      this.connected = false;
      this.container = container;
      this.render();
    }
    /**
     * Set current user ID.
     */
    setCurrentUser(userId) {
      this.currentUserId = userId;
      this.render();
    }
    /**
     * Set connection status.
     */
    setConnected(connected) {
      this.connected = connected;
      this.render();
    }
    /**
     * Set full user list.
     */
    setUsers(users) {
      this.users = users;
      this.render();
    }
    /**
     * Add a new user.
     */
    addUser(user) {
      if (!this.users.find((u) => u.id === user.id)) {
        this.users.push(user);
        this.render();
      }
    }
    /**
     * Remove a user.
     */
    removeUser(userId) {
      this.users = this.users.filter((u) => u.id !== userId);
      this.render();
    }
    /**
     * Render the user list.
     */
    render() {
      const statusClass = this.connected ? "connected" : "disconnected";
      const statusText = this.connected ? "Connected" : "Connecting...";
      this.container.innerHTML = `
      <div class="user-list-header">
        <span class="status-indicator ${statusClass}"></span>
        <span class="status-text">${statusText}</span>
        <span class="user-count">${this.users.length} user${this.users.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="user-list-items">
        ${this.users.map((user) => this.renderUser(user)).join("")}
      </div>
    `;
    }
    /**
     * Render a single user item.
     */
    renderUser(user) {
      const isCurrentUser = user.id === this.currentUserId;
      return `
      <div class="user-item ${isCurrentUser ? "current-user" : ""}">
        <span class="user-color" style="background-color: ${user.color}"></span>
        <span class="user-name">${user.name}${isCurrentUser ? " (you)" : ""}</span>
      </div>
    `;
    }
  };

  // client/main.ts
  function init() {
    console.log("[Main] Initializing Collaborative Canvas...");
    const canvas = document.getElementById("drawing-canvas");
    const cursorCanvas = document.getElementById("cursor-canvas");
    const toolbarContainer = document.getElementById("toolbar");
    const userListContainer = document.getElementById("user-list");
    if (!canvas || !cursorCanvas || !toolbarContainer || !userListContainer) {
      console.error("[Main] Required DOM elements not found");
      return;
    }
    let socketClient = null;
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
    const userList = new UserList(userListContainer);
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
    canvasManager.setSettings(toolbar.getSettings());
    const BACKEND_URL = "https://canvas-collaborate.onrender.com";
    const serverUrl = window.location.hostname === "localhost" ? window.location.origin : BACKEND_URL;
    socketClient = new SocketClient(serverUrl, {
      onConnected: (userId) => {
        console.log("[Main] Connected as user:", userId);
        userList.setConnected(true);
      },
      onDisconnected: () => {
        console.log("[Main] Disconnected");
        userList.setConnected(false);
      },
      onSyncState: (userId, users, strokes) => {
        console.log("[Main] State synced:", strokes.length, "strokes,", users.length, "users");
        canvasManager.syncState(strokes, users, userId);
        userList.setCurrentUser(userId);
        userList.setUsers(users);
      },
      onUserJoined: (user) => {
        console.log("[Main] User joined:", user.name);
        userList.addUser(user);
        canvasManager.addUser(user);
      },
      onUserLeft: (userId) => {
        console.log("[Main] User left:", userId);
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
        console.log("[Main] Undo received for stroke:", targetStrokeId);
        canvasManager.updateVisibleStrokes(visibleStrokes);
      },
      onRedo: (userId, targetUndoOpId, visibleStrokes) => {
        console.log("[Main] Redo received:", targetUndoOpId);
        canvasManager.updateVisibleStrokes(visibleStrokes);
      },
      onCanvasCleared: (userId, visibleStrokes) => {
        console.log("[Main] Canvas cleared by:", userId);
        canvasManager.updateVisibleStrokes(visibleStrokes);
      }
    });
    console.log("[Main] Initialization complete");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
