// counter-layer.js - stacked hex counters with warp-out and selection
// Requires hexviewer.js to be loaded first (uses window.HexViewer).

(function () {
    const { Layer, Geometry } = window.HexViewer;

    // -- Counter data object ---------------------------------------------------

    class Counter {
        constructor({ id, row, col, size = 'large', color = '#cc4444' }) {
            this.id    = id;
            this.row   = row;
            this.col   = col;
            this.size  = size;   // 'large' | 'small'
            this.color = color;
        }
    }

    // -- CounterLayer ----------------------------------------------------------

    class CounterLayer extends Layer {
        constructor() {
            super('counters');
            this._counters  = new Map();   // id -> Counter
            this._warpedHex = null;        // { row, col } | null
            this._selected  = new Set();   // selected counter ids
            this.largeScale = 1.15;
            this.smallScale = 0.85;

            this._boundClick  = this._onClick.bind(this);
            this._boundDblClick = this._onDblClick.bind(this);
        }

        // -- Public API -----------------------------------------------------

        addCounter(counter) {
            this._counters.set(counter.id, counter);
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        removeCounter(id) {
            this._counters.delete(id);
            this._selected.delete(id);
            if (this._warpedHex) {
                const remaining = this._countersAt(this._warpedHex.row, this._warpedHex.col);
                if (remaining.length === 0) this._warpedHex = null;
            }
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        getSelected() { return new Set(this._selected); }

        clearSelection() {
            this._selected.clear();
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        closeWarp() {
            this._warpedHex = null;
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        // -- Layer lifecycle ------------------------------------------------

        onAttach(hexMap) {
            hexMap._canvas.addEventListener('click',    this._boundClick,    { capture: true });
            hexMap._canvas.addEventListener('dblclick', this._boundDblClick, { capture: true });
        }

        onDetach(hexMap) {
            hexMap._canvas.removeEventListener('click',    this._boundClick,    { capture: true });
            hexMap._canvas.removeEventListener('dblclick', this._boundDblClick, { capture: true });
        }

        // -- Render ---------------------------------------------------------

        render(ctx, hexMap, visibleHexes) {
            const size = hexMap._layout.size;

            if (this._warpedHex) {
                this._renderWarped(ctx, hexMap, size);
            } else {
                this._renderStacks(ctx, hexMap, visibleHexes, size);
            }
        }

        // -- Stack rendering ------------------------------------------------

        _renderStacks(ctx, hexMap, visibleHexes, size) {
            const hexSet = new Map();
            for (const h of visibleHexes) hexSet.set(`${h.row},${h.col}`, h);

            // Group counters by hex
            const byHex = new Map();
            for (const c of this._counters.values()) {
                const key = `${c.row},${c.col}`;
                if (!byHex.has(key)) byHex.set(key, []);
                byHex.get(key).push(c);
            }

            for (const [key, stack] of byHex) {
                const hex = hexSet.get(key);
                if (!hex) continue;
                this._renderStack(ctx, stack, hex.cx, hex.cy, size);
            }
        }

        _renderStack(ctx, stack, cx, cy, size) {
            // Large first (bottom), then small on top
            const sorted = [...stack].sort((a, b) => {
                if (a.size === b.size) return 0;
                return a.size === 'large' ? -1 : 1;
            });

            const offsetStep = size * 0.07;
            const n = sorted.length;
            // Bottom counters are shifted down-right; top counter is at cx,cy
            for (let i = 0; i < n; i++) {
                const shift = (n - 1 - i) * offsetStep;
                const c = sorted[i];
                const selected = this._selected.has(c.id);
                this._drawCounter(ctx, cx + shift, cy + shift, c, size, selected);
            }

            if (n > 1) {
                this._drawBadge(ctx, cx, cy, n, size);
            }
        }

        // -- Warp rendering -------------------------------------------------

        _renderWarped(ctx, hexMap, size) {
            const { row, col } = this._warpedHex;
            const stack = this._countersAt(row, col);
            if (stack.length === 0) { this._warpedHex = null; return; }

            const { x: hx, y: hy } = Geometry.offsetToPixel(row, col, hexMap._layout);
            const positions = this._getWarpPositions(stack, hx, hy, size);

            // Leader lines from hex centre to each warped counter centre
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
            ctx.lineWidth   = 1 / hexMap._viewport.zoom;
            ctx.setLineDash([size * 0.15, size * 0.1]);
            for (const pos of positions) {
                ctx.beginPath();
                ctx.moveTo(hx, hy);
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.restore();

            // Draw the original stack (dimmed) at the hex
            const sorted = this._sortStack(stack);
            const offsetStep = size * 0.07;
            ctx.globalAlpha = 0.35;
            for (let i = 0; i < sorted.length; i++) {
                const shift = (sorted.length - 1 - i) * offsetStep;
                this._drawCounter(ctx, hx + shift, hy + shift, sorted[i], size, false);
            }
            ctx.globalAlpha = 1;

            // Draw warped counters
            for (let i = 0; i < stack.length; i++) {
                const c = positions[i].counter;
                const selected = this._selected.has(c.id);
                this._drawCounter(ctx, positions[i].x, positions[i].y, c, size, selected);
            }
        }

        _getWarpPositions(stack, hx, hy, size) {
            const sorted = this._sortStack(stack);
            const spacing = size * 1.15;
            const totalW  = (sorted.length - 1) * spacing;
            const startX  = hx - totalW / 2;
            const warpDy  = -(size * 1.8);
            return sorted.map((c, i) => ({
                counter: c,
                x: startX + i * spacing,
                y: hy + warpDy,
            }));
        }

        // -- Counter drawing ------------------------------------------------

        _drawCounter(ctx, cx, cy, counter, hexSize, selected) {
            const zoom = this._hexMap._viewport.zoom;
            const s    = hexSize * (counter.size === 'large' ? this.largeScale : this.smallScale);
            const half = s / 2;
            const x    = cx - half;
            const y    = cy - half;
            const sPx  = s * zoom; // rendered width in CSS pixels

            if (sPx > 14) {
                // Shadow
                const shadowOffset = s * 0.05;
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.fillRect(x + shadowOffset, y + shadowOffset, s, s);
            }

            // Main fill
            ctx.fillStyle = counter.color;
            ctx.fillRect(x, y, s, s);

            if (sPx > 14) {
                // Bevel highlight / shadow strips
                const bevel = s * 0.06;
                ctx.fillStyle = 'rgba(255,255,255,0.40)';
                ctx.fillRect(x,              y,              s,     bevel);
                ctx.fillRect(x,              y + bevel,      bevel, s - bevel);
                ctx.fillStyle = 'rgba(0,0,0,0.30)';
                ctx.fillRect(x,              y + s - bevel,  s,     bevel);
                ctx.fillRect(x + s - bevel,  y,              bevel, s - bevel);
            }

            // Selection border (always shown)
            if (selected) {
                const bevel = s * 0.06;
                ctx.strokeStyle = '#ffee00';
                ctx.lineWidth   = Math.max(1.5, s * 0.05) / zoom;
                ctx.strokeRect(x + bevel, y + bevel, s - bevel * 2, s - bevel * 2);
            }
        }

        _drawBadge(ctx, cx, cy, count, hexSize) {
            if (hexSize * 0.22 * this._hexMap._viewport.zoom < 4) return;
            const r    = hexSize * 0.22;
            const bx   = cx + hexSize * 0.32;
            const by   = cy - hexSize * 0.32;
            ctx.fillStyle = 'rgba(20,20,20,0.82)';
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${r * 1.2}px monospace`;
            ctx.fillText(String(count), bx, by);
        }

        // -- Event handlers -------------------------------------------------

        _onClick(e) {
            if (!this.visible || !this._hexMap) return;
            const { wx, wy } = this._hexMap.screenToWorld(e.clientX, e.clientY);
            const size = this._hexMap._layout.size;

            if (this._warpedHex) {
                const stack = this._countersAt(this._warpedHex.row, this._warpedHex.col);
                const { x: hx, y: hy } = Geometry.offsetToPixel(
                    this._warpedHex.row, this._warpedHex.col, this._hexMap._layout);
                const positions = this._getWarpPositions(stack, hx, hy, size);

                for (const pos of positions) {
                    if (this._hitTestCounter(wx, wy, pos.x, pos.y, pos.counter, size)) {
                        this._toggleSelect(pos.counter.id);
                        e.stopImmediatePropagation();
                        this._hexMap.refresh();
                        return;
                    }
                }

                // Click outside warp area - close warp
                this._warpedHex = null;
                this._hexMap.refresh();
                e.stopImmediatePropagation();
                return;
            }

            // Check for click on a counter stack (top counter only)
            const hit = this._hitTestStacks(wx, wy, size);
            if (hit) {
                this._toggleSelect(hit.topCounter.id);
                e.stopImmediatePropagation();
                this._hexMap.refresh();
            }
        }

        _onDblClick(e) {
            if (!this.visible || !this._hexMap) return;
            const { wx, wy } = this._hexMap.screenToWorld(e.clientX, e.clientY);
            const size = this._hexMap._layout.size;

            // Double-click on a stack: open warp
            const hit = this._hitTestStacks(wx, wy, size);
            if (hit && hit.stack.length > 1) {
                this._warpedHex = { row: hit.row, col: hit.col };
                e.stopImmediatePropagation();
                this._hexMap.refresh();
            }
        }

        // -- Hit testing ----------------------------------------------------

        _hitTestStacks(wx, wy, size) {
            const byHex = new Map();
            for (const c of this._counters.values()) {
                const key = `${c.row},${c.col}`;
                if (!byHex.has(key)) byHex.set(key, { row: c.row, col: c.col, stack: [] });
                byHex.get(key).stack.push(c);
            }

            for (const { row, col, stack } of byHex.values()) {
                const { x: hx, y: hy } = Geometry.offsetToPixel(row, col, this._hexMap._layout);
                const sorted = this._sortStack(stack);
                const topCounter = sorted[sorted.length - 1];
                if (this._hitTestCounter(wx, wy, hx, hy, topCounter, size)) {
                    return { row, col, stack, topCounter };
                }
            }
            return null;
        }

        _hitTestCounter(wx, wy, cx, cy, counter, hexSize) {
            const s    = hexSize * (counter.size === 'large' ? this.largeScale : this.smallScale);
            const half = s / 2;
            return wx >= cx - half && wx <= cx + half &&
                   wy >= cy - half && wy <= cy + half;
        }

        // -- Helpers --------------------------------------------------------

        _countersAt(row, col) {
            return [...this._counters.values()].filter(c => c.row === row && c.col === col);
        }

        _sortStack(stack) {
            return [...stack].sort((a, b) => {
                if (a.size === b.size) return 0;
                return a.size === 'large' ? -1 : 1;
            });
        }

        _toggleSelect(id) {
            if (this._selected.has(id)) this._selected.delete(id);
            else this._selected.add(id);
        }
    }

    // -- Exports ---------------------------------------------------------------

    window.HexViewer.Counter      = Counter;
    window.HexViewer.CounterLayer = CounterLayer;
})();
