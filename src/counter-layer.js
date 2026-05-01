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
            this._counters      = new Map();   // id -> Counter
            this._hexOrientations = new Map(); // "row,col" -> angle in radians (0, π/3, 2π/3, …)
            this._warpedHex     = null;        // { row, col } | null
            this._selected      = new Set();   // selected counter ids
            this.largeScale     = 1.15;
            this.smallScale     = 0.85;

            // Optional callback fired whenever the selection changes.
            // Receives a snapshot Set of the currently selected ids.
            this.onSelectionChange = null;

            // Optional callback fired on right-click over a counter.
            // Receives (counter, stack[], clientX, clientY).
            this.onContextMenu = null;

            this._boundClick       = this._onClick.bind(this);
            this._boundDblClick    = this._onDblClick.bind(this);
            this._boundContextMenu = this._onContextMenu.bind(this);
        }

        // -- Public API -----------------------------------------------------

        addCounter(counter) {
            this._counters.set(counter.id, counter);
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        removeCounter(id) {
            this._counters.delete(id);
            const wasSelected = this._selected.delete(id);
            if (this._warpedHex) {
                const remaining = this._countersAt(this._warpedHex.row, this._warpedHex.col);
                if (remaining.length === 0) this._warpedHex = null;
            }
            this._hexMap && this._hexMap.refresh();
            if (wasSelected) this._notifySelectionChange();
            return this;
        }

        getSelected() { return new Set(this._selected); }

        getCounter(id) { return this._counters.get(id) || null; }

        // Replace the current selection with the given ids.
        setSelection(ids) {
            this._selected = new Set(ids);
            this._hexMap && this._hexMap.refresh();
            this._notifySelectionChange();
            return this;
        }

        clearSelection() {
            this._selected.clear();
            this._hexMap && this._hexMap.refresh();
            this._notifySelectionChange();
            return this;
        }

        closeWarp() {
            this._warpedHex = null;
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        // -- Hex facing orientation -----------------------------------------

        // Returns the facing angle in radians for the given hex (default 0).
        getHexOrientation(row, col) {
            return this._hexOrientations.get(`${row},${col}`) || 0;
        }

        // Sets the facing angle for the given hex to the nearest 60° step.
        setHexOrientation(row, col, angleRad) {
            const step = Math.PI / 3;
            const snapped = Math.round(angleRad / step) * step;
            const norm    = ((snapped % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            this._hexOrientations.set(`${row},${col}`, norm);
            this._hexMap && this._hexMap.refresh();
            return this;
        }

        // Rotate the hex's facing by steps × 60°.  Positive = clockwise.
        rotateHex(row, col, steps = 1) {
            const current = this.getHexOrientation(row, col);
            return this.setHexOrientation(row, col, current + steps * Math.PI / 3);
        }

        // -- Layer lifecycle ------------------------------------------------

        onAttach(hexMap) {
            hexMap._canvas.addEventListener('click',       this._boundClick,       { capture: true });
            hexMap._canvas.addEventListener('dblclick',    this._boundDblClick,    { capture: true });
            hexMap._canvas.addEventListener('contextmenu', this._boundContextMenu, { capture: true });
        }

        onDetach(hexMap) {
            hexMap._canvas.removeEventListener('click',       this._boundClick,       { capture: true });
            hexMap._canvas.removeEventListener('dblclick',    this._boundDblClick,    { capture: true });
            hexMap._canvas.removeEventListener('contextmenu', this._boundContextMenu, { capture: true });
        }

        // -- Render ---------------------------------------------------------

        render(ctx, hexMap, visibleHexes) {
            const size = hexMap._layout.size;

            if (this._warpedHex) {
                // Render all non-warped stacks dimmed, then the warp view on top.
                this._renderStacksDimmed(ctx, hexMap, visibleHexes, size);
                this._renderWarped(ctx, hexMap, size);
            } else {
                this._renderStacks(ctx, hexMap, visibleHexes, size);
            }
        }

        // -- Stack rendering ------------------------------------------------

        _renderStacks(ctx, hexMap, visibleHexes, size) {
            const hexSet = new Map();
            for (const h of visibleHexes) hexSet.set(`${h.row},${h.col}`, h);

            const byHex = new Map();
            for (const c of this._counters.values()) {
                const key = `${c.row},${c.col}`;
                if (!byHex.has(key)) byHex.set(key, []);
                byHex.get(key).push(c);
            }

            for (const [key, stack] of byHex) {
                const hex = hexSet.get(key);
                if (!hex) continue;
                const facing = this.getHexOrientation(hex.row, hex.col);
                this._renderStack(ctx, stack, hex.cx, hex.cy, size, facing);
            }
        }

        _renderStack(ctx, stack, cx, cy, size, facing = 0) {
            const sorted = [...stack].sort((a, b) => {
                if (a.size === b.size) return 0;
                return a.size === 'large' ? -1 : 1;
            });

            const offsetStep = size * 0.07;
            const n = sorted.length;
            const angle = this._hexMap._viewport.angle;
            // Stack offset goes in the screen-right-down direction so it always
            // appears as a bottom-right shadow regardless of map rotation.
            const cos_a = Math.cos(angle), sin_a = Math.sin(angle);
            const rdx = (cos_a + sin_a) / Math.SQRT2;
            const rdy = (-sin_a + cos_a) / Math.SQRT2;

            for (let i = 0; i < n; i++) {
                const shift = (n - 1 - i) * offsetStep;
                const c = sorted[i];
                this._drawCounter(ctx, cx + shift * rdx, cy + shift * rdy, c, size,
                                  this._selected.has(c.id), facing);
            }

            if (n > 1) this._drawBadge(ctx, cx, cy, n, size);
        }

        // Render all stacks except the currently warped hex at reduced opacity.
        _renderStacksDimmed(ctx, hexMap, visibleHexes, size) {
            const hexSet = new Map();
            for (const h of visibleHexes) hexSet.set(`${h.row},${h.col}`, h);

            const byHex = new Map();
            for (const c of this._counters.values()) {
                const key = `${c.row},${c.col}`;
                if (!byHex.has(key)) byHex.set(key, []);
                byHex.get(key).push(c);
            }

            const skipKey = `${this._warpedHex.row},${this._warpedHex.col}`;
            ctx.globalAlpha = 0.35;
            for (const [key, stack] of byHex) {
                if (key === skipKey) continue;
                const hex = hexSet.get(key);
                if (!hex) continue;
                const facing = this.getHexOrientation(stack[0].row, stack[0].col);
                this._renderStack(ctx, stack, hex.cx, hex.cy, size, facing);
            }
            ctx.globalAlpha = 1;
        }

        // -- Warp rendering -------------------------------------------------

        _renderWarped(ctx, hexMap, size) {
            const { row, col } = this._warpedHex;
            const stack = this._countersAt(row, col);
            if (stack.length === 0) { this._warpedHex = null; return; }

            const { x: hx, y: hy } = Geometry.offsetToPixel(row, col, hexMap._layout);
            const angle    = hexMap._viewport.angle;
            const facing   = this.getHexOrientation(row, col);
            const positions = this._getWarpPositions(stack, hx, hy, size, angle);

            // Leader lines from hex centre to each warped counter centre
            ctx.save();
            ctx.strokeStyle = this._leaderLineColor(hexMap);
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
            const sorted     = this._sortStack(stack);
            const offsetStep = size * 0.07;
            const cos_a      = Math.cos(angle), sin_a = Math.sin(angle);
            const rdx        = (cos_a + sin_a) / Math.SQRT2;
            const rdy        = (-sin_a + cos_a) / Math.SQRT2;

            ctx.globalAlpha = 0.35;
            for (let i = 0; i < sorted.length; i++) {
                const shift = (sorted.length - 1 - i) * offsetStep;
                this._drawCounter(ctx, hx + shift * rdx, hy + shift * rdy, sorted[i], size, false, facing);
            }
            ctx.globalAlpha = 1;

            // Draw warped counters
            for (const pos of positions) {
                this._drawCounter(ctx, pos.x, pos.y, pos.counter, size,
                                  this._selected.has(pos.counter.id), facing);
            }
        }

        // Compute warp positions in world space such that the fan appears
        // spread horizontally and shifted straight up on screen, regardless
        // of the current map rotation angle.
        _getWarpPositions(stack, hx, hy, size, angle) {
            const sorted  = this._sortStack(stack);
            const spacing = size * 1.15;
            const warpUp  = size * 1.8;
            const totalW  = (sorted.length - 1) * spacing;
            const cos_a   = Math.cos(angle);
            const sin_a   = Math.sin(angle);

            return sorted.map((c, i) => {
                const offset = i * spacing - totalW / 2;
                return {
                    counter: c,
                    // offset along screen-right: world (+cos_a, -sin_a) per unit
                    // warpUp along screen-up:    world (-sin_a, -cos_a) per unit
                    x: hx + offset * cos_a - warpUp * sin_a,
                    y: hy - offset * sin_a - warpUp * cos_a,
                };
            });
        }

        // -- Counter drawing ------------------------------------------------

        // Counters are rendered upright on screen (counter-rotated from the map)
        // and rotated to their hex facing direction.
        _drawCounter(ctx, cx, cy, counter, hexSize, selected, facing = 0) {
            const zoom  = this._hexMap._viewport.zoom;
            const angle = this._hexMap._viewport.angle;
            const s     = hexSize * (counter.size === 'large' ? this.largeScale : this.smallScale);
            const half  = s / 2;
            const sPx   = s * zoom;

            ctx.save();
            ctx.translate(cx, cy);
            // Counter-rotate to keep upright, then rotate to hex facing direction.
            ctx.rotate(-angle + facing);

            if (sPx > 14) {
                const shadowOffset = s * 0.05;
                ctx.fillStyle = 'rgba(0,0,0,0.45)';
                ctx.fillRect(-half + shadowOffset, -half + shadowOffset, s, s);
            }

            ctx.fillStyle = counter.color;
            ctx.fillRect(-half, -half, s, s);

            if (sPx > 14) {
                const bevel = s * 0.06;
                ctx.fillStyle = 'rgba(255,255,255,0.40)';
                ctx.fillRect(-half,              -half,              s,            bevel        );
                ctx.fillRect(-half,              -half + bevel,      bevel,        s - bevel    );
                ctx.fillStyle = 'rgba(0,0,0,0.30)';
                ctx.fillRect(-half,              -half + s - bevel,  s,            bevel        );
                ctx.fillRect(-half + s - bevel,  -half,              bevel,        s - bevel    );

                // Arrow pointing toward the hex facing direction ("up" in counter-local space)
                const aw = s * 0.32;
                const ah = s * 0.28;
                const ay = -s * 0.06;
                ctx.fillStyle   = 'rgba(255,255,255,0.82)';
                ctx.strokeStyle = 'rgba(0,0,0,0.28)';
                ctx.lineWidth   = s * 0.025;
                ctx.beginPath();
                ctx.moveTo(0,        ay - ah / 2);
                ctx.lineTo(-aw / 2,  ay + ah / 2);
                ctx.lineTo( aw / 2,  ay + ah / 2);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
            }

            if (selected) {
                const bevel = s * 0.06;
                ctx.strokeStyle = '#ffee00';
                ctx.lineWidth   = Math.max(1.5, s * 0.05) / zoom;
                ctx.strokeRect(-half + bevel, -half + bevel, s - bevel * 2, s - bevel * 2);
            }

            ctx.restore();
        }

        _drawBadge(ctx, cx, cy, count, hexSize) {
            if (hexSize * 0.22 * this._hexMap._viewport.zoom < 4) return;
            const angle = this._hexMap._viewport.angle;
            const r  = hexSize * 0.22;
            const bx = hexSize * 0.32;
            const by = -hexSize * 0.32;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-angle);   // keep badge text upright
            ctx.fillStyle = 'rgba(20,20,20,0.82)';
            ctx.beginPath();
            ctx.arc(bx, by, r, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle    = '#ffffff';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${r * 1.2}px monospace`;
            ctx.fillText(String(count), bx, by);
            ctx.restore();
        }

        // -- Event handlers -------------------------------------------------

        _onClick(e) {
            if (!this.visible || !this._hexMap) return;
            const { wx, wy } = this._hexMap.screenToWorld(e.clientX, e.clientY);
            const size  = this._hexMap._layout.size;
            const shift = e.shiftKey;

            if (this._warpedHex) {
                const stack = this._countersAt(this._warpedHex.row, this._warpedHex.col);
                const { x: hx, y: hy } = Geometry.offsetToPixel(
                    this._warpedHex.row, this._warpedHex.col, this._hexMap._layout);
                const positions = this._getWarpPositions(
                    stack, hx, hy, size, this._hexMap._viewport.angle);

                for (const pos of positions) {
                    if (this._hitTestCounter(wx, wy, pos.x, pos.y, pos.counter, size)) {
                        if (shift) {
                            this._toggleSelect(pos.counter.id);
                        } else {
                            this._selected.clear();
                            this._selected.add(pos.counter.id);
                        }
                        e.stopImmediatePropagation();
                        this._hexMap.refresh();
                        this._notifySelectionChange();
                        return;
                    }
                }

                // Click outside warp area - close warp
                this._warpedHex = null;
                this._hexMap.refresh();
                e.stopImmediatePropagation();
                return;
            }

            // Click on a counter stack
            const hit = this._hitTestStacks(wx, wy, size);
            if (hit) {
                const stackIds = hit.stack.map(c => c.id);
                if (shift) {
                    const allSelected = stackIds.every(id => this._selected.has(id));
                    if (allSelected) stackIds.forEach(id => this._selected.delete(id));
                    else             stackIds.forEach(id => this._selected.add(id));
                } else {
                    this._selected.clear();
                    stackIds.forEach(id => this._selected.add(id));
                }
                e.stopImmediatePropagation();
                this._hexMap.refresh();
                this._notifySelectionChange();
            }
        }

        _onDblClick(e) {
            if (!this.visible || !this._hexMap) return;
            const { wx, wy } = this._hexMap.screenToWorld(e.clientX, e.clientY);
            const size = this._hexMap._layout.size;

            const hit = this._hitTestStacks(wx, wy, size);
            if (hit && hit.stack.length > 1) {
                this._warpedHex = { row: hit.row, col: hit.col };
                e.stopImmediatePropagation();
                this._hexMap.refresh();
            }
        }

        _onContextMenu(e) {
            if (!this.visible || !this._hexMap || !this.onContextMenu) return;
            const { wx, wy } = this._hexMap.screenToWorld(e.clientX, e.clientY);
            const size = this._hexMap._layout.size;

            let hitCounter = null;
            let hitStack   = null;

            if (this._warpedHex) {
                const stack = this._countersAt(this._warpedHex.row, this._warpedHex.col);
                const { x: hx, y: hy } = Geometry.offsetToPixel(
                    this._warpedHex.row, this._warpedHex.col, this._hexMap._layout);
                const positions = this._getWarpPositions(
                    stack, hx, hy, size, this._hexMap._viewport.angle);
                for (const pos of positions) {
                    if (this._hitTestCounter(wx, wy, pos.x, pos.y, pos.counter, size)) {
                        hitCounter = pos.counter;
                        hitStack   = stack;
                        break;
                    }
                }
            } else {
                const hit = this._hitTestStacks(wx, wy, size);
                if (hit) { hitCounter = hit.topCounter; hitStack = hit.stack; }
            }

            if (hitCounter) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.onContextMenu(hitCounter, hitStack, e.clientX, e.clientY);
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

        // Circular hit area (radius = half × √2) covers the counter regardless
        // of its screen rotation.
        _hitTestCounter(wx, wy, cx, cy, counter, hexSize) {
            const s    = hexSize * (counter.size === 'large' ? this.largeScale : this.smallScale);
            const half = s / 2;
            const dx = wx - cx, dy = wy - cy;
            return dx * dx + dy * dy <= half * half * 2;
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

        _notifySelectionChange() {
            if (this.onSelectionChange) this.onSelectionChange(new Set(this._selected));
        }

        _leaderLineColor(hexMap) {
            const bg = hexMap.background;
            if (!bg) return 'rgba(128,128,128,0.55)';
            const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
            if (!m) return 'rgba(128,128,128,0.55)';
            const lum = (0.299 * parseInt(m[1], 16) +
                         0.587 * parseInt(m[2], 16) +
                         0.114 * parseInt(m[3], 16)) / 255;
            return lum > 0.5 ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.45)';
        }
    }

    // -- Exports ---------------------------------------------------------------

    window.HexViewer.Counter      = Counter;
    window.HexViewer.CounterLayer = CounterLayer;
})();
