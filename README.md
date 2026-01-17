# Collaborative Canvas

A real-time collaborative drawing canvas with global undo/redo, built from scratch using raw HTML5 Canvas API and Socket.io.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build client bundle
npm run build:client

# Start server (development)
npm run dev

# Or: Start server (production)
npm start
```

Open `http://localhost:3000` in multiple browser tabs to test collaboration.

## 🧪 Testing Multi-User Collaboration

1. Open **Tab A**: `http://localhost:3000`
2. Open **Tab B**: `http://localhost:3000`
3. Draw in Tab A → Stroke appears in Tab B
4. Click Undo in Tab A → Stroke disappears from both
5. Click Redo in Tab B → Stroke reappears in both

### Test Scenarios

| Test | Steps | Expected |
|------|-------|----------|
| Real-time sync | Draw in Tab A | Stroke appears in Tab B while drawing, not on mouseup |
| Cross-user undo | A draws S1, B draws S2, A clicks Undo | S2 disappears from both tabs |
| Redo | After above, B clicks Redo | S2 reappears |
| Join sync | A draws, open Tab B | Tab B sees all strokes immediately |
| Cursor visibility | Move mouse in Tab A | Colored cursor moves in Tab B |

## ⌨️ Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `B` | Select brush |
| `E` | Select eraser |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |

## 🏗️ Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation.

### File Structure

```
collaborative-canvas/
├── client/
│   ├── index.html          # HTML entry
│   ├── style.css           # Styles
│   ├── main.ts             # Orchestration
│   ├── canvas/
│   │   ├── stroke.ts       # Type definitions
│   │   ├── canvasManager.ts # Input handling
│   │   └── redraw.ts       # Rendering
│   ├── socket/
│   │   └── socketClient.ts # WebSocket layer
│   └── ui/
│       ├── toolbar.ts      # Tool controls
│       └── userList.ts     # User display
├── server/
│   ├── server.ts           # Entry point
│   ├── rooms.ts            # User management
│   ├── drawingState.ts     # State + undo/redo
│   └── socketHandlers.ts   # Event handlers
└── ARCHITECTURE.md         # Technical docs
```

## ⚠️ Known Limitations

1. **Single room** - No room selection UI (interview scope)
2. **No persistence** - State lost on server restart
3. **No undo limit** - Memory grows unbounded (production would cap at ~100 ops)
4. **Canvas 2D** - Limited to ~10k strokes before performance degrades

## ⏱️ Time Breakdown

| Phase | Time |
|-------|------|
| Architecture design | ~30 min |
| Server implementation | ~1.5 hr |
| Client implementation | ~2 hr |
| Styling & polish | ~45 min |
| Documentation | ~45 min |
| **Total** | **~5.5 hr** |

## 📝 License

MIT
