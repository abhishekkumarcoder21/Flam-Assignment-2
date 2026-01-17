/**
 * toolbar.ts - Drawing tool selection UI
 * 
 * RESPONSIBILITY: Tool selection interface
 * - Brush/eraser toggle
 * - Color picker
 * - Width slider
 * - Undo/redo buttons
 * 
 * DESIGN: Event-driven
 * Emits callbacks on setting changes, doesn't know about canvas or socket.
 */

import { Tool, DrawingSettings } from '../canvas/stroke';

export type ToolbarCallbacks = {
    onSettingsChange: (settings: Partial<DrawingSettings>) => void;
    onUndo: () => void;
    onRedo: () => void;
    onClear: () => void;
};

// Preset colors for quick selection
const PRESET_COLORS = [
    '#000000', // Black
    '#FFFFFF', // White
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
];

/**
 * Toolbar manages the drawing controls UI.
 */
export class Toolbar {
    private container: HTMLElement;
    private callbacks: ToolbarCallbacks;

    // Current state
    private currentTool: Tool = 'brush';
    private currentColor: string = '#000000';
    private currentWidth: number = 5;

    // UI elements
    private brushBtn!: HTMLButtonElement;
    private eraserBtn!: HTMLButtonElement;
    private colorPicker!: HTMLInputElement;
    private widthSlider!: HTMLInputElement;
    private widthDisplay!: HTMLSpanElement;

    constructor(container: HTMLElement, callbacks: ToolbarCallbacks) {
        this.container = container;
        this.callbacks = callbacks;

        this.createUI();
        this.bindEvents();
    }

    /**
     * Create toolbar HTML structure.
     */
    private createUI(): void {
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
          ${PRESET_COLORS.map(color => `
            <button class="color-btn ${color === this.currentColor ? 'active' : ''}" 
                    data-color="${color}" 
                    style="background-color: ${color}; ${color === '#FFFFFF' ? 'border: 1px solid #ccc;' : ''}"
                    title="${color}">
            </button>
          `).join('')}
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

        // Cache element references
        this.brushBtn = document.getElementById('brush-btn') as HTMLButtonElement;
        this.eraserBtn = document.getElementById('eraser-btn') as HTMLButtonElement;
        this.colorPicker = document.getElementById('color-picker') as HTMLInputElement;
        this.widthSlider = document.getElementById('width-slider') as HTMLInputElement;
        this.widthDisplay = document.getElementById('width-display') as HTMLSpanElement;
    }

    /**
     * Bind event listeners.
     */
    private bindEvents(): void {
        // Tool buttons
        this.brushBtn.addEventListener('click', () => this.setTool('brush'));
        this.eraserBtn.addEventListener('click', () => this.setTool('eraser'));

        // Color presets
        const colorBtns = this.container.querySelectorAll('.color-btn');
        colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const color = (btn as HTMLElement).dataset.color!;
                this.setColor(color);
            });
        });

        // Custom color picker
        this.colorPicker.addEventListener('input', (e) => {
            this.setColor((e.target as HTMLInputElement).value);
        });

        // Width slider
        this.widthSlider.addEventListener('input', (e) => {
            const width = parseInt((e.target as HTMLInputElement).value, 10);
            this.setWidth(width);
        });

        // Action buttons
        document.getElementById('undo-btn')!.addEventListener('click', () => {
            this.callbacks.onUndo();
        });

        document.getElementById('redo-btn')!.addEventListener('click', () => {
            this.callbacks.onRedo();
        });

        document.getElementById('clear-btn')!.addEventListener('click', () => {
            if (confirm('Clear the entire canvas? This can be undone.')) {
                this.callbacks.onClear();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ignore if typing in an input
            if ((e.target as HTMLElement).tagName === 'INPUT') return;

            if (e.key === 'b' || e.key === 'B') {
                this.setTool('brush');
            } else if (e.key === 'e' || e.key === 'E') {
                this.setTool('eraser');
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.callbacks.onRedo();
                } else {
                    this.callbacks.onUndo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.callbacks.onRedo();
            }
        });
    }

    /**
     * Set current tool.
     */
    private setTool(tool: Tool): void {
        this.currentTool = tool;

        // Update button states
        this.brushBtn.classList.toggle('active', tool === 'brush');
        this.eraserBtn.classList.toggle('active', tool === 'eraser');

        // Notify callback
        this.callbacks.onSettingsChange({ tool });
    }

    /**
     * Set current color.
     */
    private setColor(color: string): void {
        this.currentColor = color;

        // Update color picker
        this.colorPicker.value = color;

        // Update preset button active states
        const colorBtns = this.container.querySelectorAll('.color-btn');
        colorBtns.forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.color === color);
        });

        // Notify callback
        this.callbacks.onSettingsChange({ color });
    }

    /**
     * Set current width.
     */
    private setWidth(width: number): void {
        this.currentWidth = width;

        // Update display
        this.widthDisplay.textContent = String(width);
        this.widthSlider.value = String(width);

        // Notify callback
        this.callbacks.onSettingsChange({ width });
    }

    /**
     * Get current settings.
     */
    getSettings(): DrawingSettings {
        return {
            tool: this.currentTool,
            color: this.currentColor,
            width: this.currentWidth
        };
    }
}
