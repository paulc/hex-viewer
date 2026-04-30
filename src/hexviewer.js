(function () {
'use strict';

// ── Orientation constants (redblobgames) ──────────────────────────────────────

const FLAT_TOP = Object.freeze({
    f: [3 / 2, 0, Math.sqrt(3) / 2, Math.sqrt(3)],
    b: [2 / 3, 0, -1 / 3, Math.sqrt(3) / 3],
    startAngle: 0,
    name: 'flat-top',
});

const POINTY_TOP = Object.freeze({
    f: [Math.sqrt(3), Math.sqrt(3) / 2, 0, 3 / 2],
    b: [Math.sqrt(3) / 3, -1 / 3, 0, 2 / 3],
    startAngle: 0.5,
    name: 'pointy-top',
});

const OFFSET_ODD  = -1;
const OFFSET_EVEN =  1;

const CUBE_DIRECTIONS = [
    { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
    { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
];

// ── Geometry namespace (pure functions) ───────────────────────────────────────

const Geometry = {

    // Offset → axial. Uses Math.trunc (not Math.floor) for negative-coord safety.
    offsetToAxial(row, col, orientation, parity) {
        if (orientation === POINTY_TOP) {
            return { q: col - Math.trunc((row + parity * (row & 1)) / 2), r: row };
        }
        return { q: col, r: row - Math.trunc((col + parity * (col & 1)) / 2) };
    },

    axialToOffset(q, r, orientation, parity) {
        if (orientation === POINTY_TOP) {
            return { row: r, col: q + Math.trunc((r + parity * (r & 1)) / 2) };
        }
        return { row: r + Math.trunc((q + parity * (q & 1)) / 2), col: q };
    },

    // Exact cube-round from redblobgames
    cubeRound(fq, fr, fs) {
        let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
        const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
        if      (dq > dr && dq > ds) q = -r - s;
        else if (dr > ds)            r = -q - s;
        else                         s = -q - r;
        return { q, r, s };
    },

    axialToPixel(q, r, layout) {
        const { orientation: o, size, origin, yFlip } = layout;
        return {
            x: (o.f[0] * q + o.f[1] * r) * size + origin.x,
            y: yFlip * (o.f[2] * q + o.f[3] * r) * size + origin.y,
        };
    },

    pixelToAxial(px, py, layout) {
        const { orientation: o, size, origin, yFlip } = layout;
        const ptx = (px - origin.x) / size;
        const pty = yFlip * (py - origin.y) / size;
        const fq  = o.b[0] * ptx + o.b[1] * pty;
        const fr  = o.b[2] * ptx + o.b[3] * pty;
        const { q, r } = this.cubeRound(fq, fr, -fq - fr);
        return { q, r };
    },

    offsetToPixel(row, col, layout) {
        const { q, r } = this.offsetToAxial(row, col, layout.orientation, layout.parity);
        return this.axialToPixel(q, r, layout);
    },

    pixelToOffset(px, py, layout) {
        const { q, r } = this.pixelToAxial(px, py, layout);
        return this.axialToOffset(q, r, layout.orientation, layout.parity);
    },

    hexCorners(cx, cy, cornerOffsets) {
        return cornerOffsets.map(({ dx, dy }) => ({ x: cx + dx, y: cy + dy }));
    },

    cubeNeighbor(q, r, s, direction) {
        const d = CUBE_DIRECTIONS[direction];
        return { q: q + d.q, r: r + d.r, s: s + d.s };
    },

    offsetNeighbors(row, col, orientation, parity) {
        const { q, r } = this.offsetToAxial(row, col, orientation, parity);
        const s = -q - r;
        return CUBE_DIRECTIONS.map((_, i) => {
            const n = this.cubeNeighbor(q, r, s, i);
            return this.axialToOffset(n.q, n.r, orientation, parity);
        });
    },

    hexDistance(q1, r1, s1, q2, r2, s2) {
        return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(s1 - s2)) / 2;
    },

    // Precompute per-layout corner offsets once (avoids per-hex trig).
    // yFlip negates sin (Y reflection) but not cos (no X reflection).
    computeCornerOffsets(layout) {
        return Array.from({ length: 6 }, (_, i) => {
            const angle = (2 * Math.PI * (layout.orientation.startAngle + i)) / 6;
            return { dx: layout.size * Math.cos(angle), dy: layout.yFlip * layout.size * Math.sin(angle) };
        });
    },
};

// ── Layer base class ──────────────────────────────────────────────────────────

class Layer {
    constructor(name, visible = true) {
        this._name    = name;
        this._visible = visible;
        this._hexMap  = null;
    }

    get name()    { return this._name; }
    get visible() { return this._visible; }

    set visible(v) {
        this._visible = !!v;
        if (this._hexMap) this._hexMap._scheduleRender();
    }

    // Override in subclasses. ctx is already in world space (pan/rotate/zoom applied).
    render(_ctx, _hexMap, _visibleHexes) {}
}

// ── Built-in layers ───────────────────────────────────────────────────────────

class HexOutlineLayer extends Layer {
    constructor(options = {}) {
        super('hex-outline', options.visible !== false);
        this.strokeStyle = options.strokeStyle || '#556677';
        this.lineWidth   = options.lineWidth   || 1;
    }

    render(ctx, hexMap, visibleHexes) {
        const co = hexMap.cornerOffsets;
        ctx.strokeStyle = this.strokeStyle;
        // Compensate lineWidth for zoom so outlines stay 1 CSS-pixel wide
        ctx.lineWidth = this.lineWidth / hexMap._viewport.zoom;
        ctx.beginPath();
        for (const hex of visibleHexes) {
            const c = Geometry.hexCorners(hex.cx, hex.cy, co);
            ctx.moveTo(c[0].x, c[0].y);
            for (let i = 1; i < 6; i++) ctx.lineTo(c[i].x, c[i].y);
            ctx.closePath();
        }
        ctx.stroke();
    }
}

class HexLabelLayer extends Layer {
    constructor(options = {}) {
        super('hex-label', options.visible !== false);
        this.fillStyle = options.fillStyle || '#223344';
    }

    render(ctx, hexMap, visibleHexes) {
        const { size, orientation } = hexMap._layout;
        // Flat-top: label just inside the top flat edge.
        // Pointy-top: label near the bottom vertex.
        // These world-y offsets work for both yFlip values because the visual
        // top/bottom of a hex always lands at the same world-y relative to centre.
        const dy = orientation === FLAT_TOP
            ? -(size * (Math.sqrt(3) / 2 - 0.30))
            :   (size * 0.58);
        ctx.fillStyle    = this.fillStyle;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = `${size * 0.28}px monospace`;
        for (const hex of visibleHexes) {
            ctx.fillText(hexMap.getHexLabel(hex.row, hex.col), hex.cx, hex.cy + dy);
        }
    }
}

class CenterDotLayer extends Layer {
    constructor(options = {}) {
        super('center-dot', options.visible !== false);
        this.fillStyle = options.fillStyle || '#334455';
    }

    render(ctx, hexMap, visibleHexes) {
        const radius = hexMap._layout.size * 0.05;
        ctx.fillStyle = this.fillStyle;
        for (const hex of visibleHexes) {
            ctx.beginPath();
            ctx.arc(hex.cx, hex.cy, radius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

// ── HexMap ────────────────────────────────────────────────────────────────────

class HexMap {
    constructor(canvas, options = {}) {
        this._canvas    = canvas;
        this._ctx       = canvas.getContext('2d');
        this._dpr       = window.devicePixelRatio || 1;
        this._destroyed = false;

        const {
            rows         = 10,
            cols         = 10,
            hexSize      = 40,
            orientation  = POINTY_TOP,
            offsetParity = OFFSET_ODD,
            originCorner = 'top-left',
            getHexLabel  = null,
            minZoom      = 0.1,
            maxZoom      = 10,
            background   = null,
            rotationStep = 60,
        } = options;

        this._rows         = rows;
        this._cols         = cols;
        this._minZoom      = minZoom;
        this._maxZoom      = maxZoom;
        this._background   = background;
        this._rotationStep = rotationStep;

        this._layout = {
            orientation,
            size:   hexSize,
            origin: { x: 0, y: 0 },
            parity: offsetParity,
            yFlip:  originCorner === 'bottom-left' ? -1 : 1,
        };

        this._cornerOffsets = Geometry.computeCornerOffsets(this._layout);

        this._getHexLabel = getHexLabel || ((row, col) =>
            `${String(row).padStart(2, '0')}${String(col).padStart(2, '0')}`
        );

        this._viewport = { panX: 0, panY: 0, zoom: 1, angle: 0 };
        this._layers   = [];
        this._dirty    = false;
        this._drag     = null;
        this._handlers = {};

        this.addLayer(new HexOutlineLayer());
        this.addLayer(new HexLabelLayer());
        this.addLayer(new CenterDotLayer());

        this._setupCanvas();
        this._setupEvents();
        this.fitToView();
    }

    // ── Public accessors ────────────────────────────────────────────────────

    get layout()        { return this._layout; }
    get cornerOffsets() { return this._cornerOffsets; }

    get background()    { return this._background; }
    set background(c)   { this._background = c; this._scheduleRender(); }

    get rotationStep()  { return this._rotationStep; }
    set rotationStep(s) { this._rotationStep = Math.max(1, Math.abs(s)); }

    getHexLabel(row, col) { return this._getHexLabel(row, col); }

    // ── Layer management ────────────────────────────────────────────────────

    addLayer(layer, index) {
        layer._hexMap = this;
        if (index === undefined) this._layers.push(layer);
        else this._layers.splice(index, 0, layer);
        this._scheduleRender();
        return this;
    }

    removeLayer(name) {
        const idx = this._layers.findIndex(l => l.name === name);
        if (idx !== -1) {
            this._layers[idx]._hexMap = null;
            this._layers.splice(idx, 1);
            this._scheduleRender();
        }
        return this;
    }

    getLayer(name)  { return this._layers.find(l => l.name === name) || null; }
    getLayers()     { return [...this._layers]; }

    setLayerVisible(name, visible) {
        const layer = this.getLayer(name);
        if (layer) { layer._visible = !!visible; this._scheduleRender(); }
        return this;
    }

    // ── Viewport ────────────────────────────────────────────────────────────

    getViewport() {
        const { panX, panY, zoom, angle } = this._viewport;
        return { panX, panY, zoom, angle };
    }

    setViewport({ panX, panY, zoom, angle } = {}) {
        if (panX  !== undefined) this._viewport.panX  = panX;
        if (panY  !== undefined) this._viewport.panY  = panY;
        if (zoom  !== undefined) this._viewport.zoom  = zoom;
        if (angle !== undefined) this._viewport.angle = angle;
        this._scheduleRender();
        return this;
    }

    panTo(row, col) {
        const { x, y }       = Geometry.offsetToPixel(row, col, this._layout);
        const { zoom, angle } = this._viewport;
        const cw = this._canvas.clientWidth;
        const ch = this._canvas.clientHeight;
        this._viewport.panX = cw / 2 - zoom * (x * Math.cos(angle) - y * Math.sin(angle));
        this._viewport.panY = ch / 2 - zoom * (x * Math.sin(angle) + y * Math.cos(angle));
        this._scheduleRender();
        return this;
    }

    setZoom(z) {
        const cw = this._canvas.clientWidth  / 2;
        const ch = this._canvas.clientHeight / 2;
        this._applyZoom(Math.max(this._minZoom, Math.min(this._maxZoom, z)), cw, ch);
        return this;
    }

    fitToView() {
        const cw = this._canvas.clientWidth;
        const ch = this._canvas.clientHeight;
        if (!cw || !ch) return this;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        // Only check border hexes — interior can't extend beyond them
        for (let row = 0; row < this._rows; row++) {
            for (let col = 0; col < this._cols; col++) {
                if (row > 0 && row < this._rows - 1 && col > 0 && col < this._cols - 1) continue;
                const { x, y } = Geometry.offsetToPixel(row, col, this._layout);
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }

        const pad = this._layout.size * 1.2;
        minX -= pad; minY -= pad; maxX += pad; maxY += pad;

        const zoom = Math.max(this._minZoom, Math.min(this._maxZoom,
            Math.min(cw / (maxX - minX), ch / (maxY - minY))));

        this._viewport.angle = 0;
        this._viewport.zoom  = zoom;
        this._viewport.panX  = cw / 2 - zoom * (minX + maxX) / 2;
        this._viewport.panY  = ch / 2 - zoom * (minY + maxY) / 2;
        this._scheduleRender();
        return this;
    }

    // ── Rotation (configurable step, default 60°) ────────────────────────────

    rotateBy(steps) {
        return this.setRotation(this.getRotation() + steps * this._rotationStep);
    }

    setRotation(angleDeg) {
        const snapped  = Math.round(angleDeg / this._rotationStep) * this._rotationStep;
        const newAngle = (((snapped % 360) + 360) % 360) * Math.PI / 180;
        const oldAngle = this._viewport.angle;
        const { zoom, panX, panY } = this._viewport;
        const cx = this._canvas.clientWidth  / 2;
        const cy = this._canvas.clientHeight / 2;

        // World point currently under canvas centre (inverse of old transform)
        const dx = cx - panX, dy = cy - panY;
        const wx = (dx * Math.cos(-oldAngle) - dy * Math.sin(-oldAngle)) / zoom;
        const wy = (dx * Math.sin(-oldAngle) + dy * Math.cos(-oldAngle)) / zoom;

        // New pan: same world point stays under canvas centre
        this._viewport.angle = newAngle;
        this._viewport.panX  = cx - zoom * (wx * Math.cos(newAngle) - wy * Math.sin(newAngle));
        this._viewport.panY  = cy - zoom * (wx * Math.sin(newAngle) + wy * Math.cos(newAngle));
        this._scheduleRender();
        this._emit('viewportChange', this.getViewport());
        return this;
    }

    getRotation() {
        return Math.round((((this._viewport.angle * 180 / Math.PI) % 360) + 360) % 360);
    }

    // ── Events ────────────────────────────────────────────────────────────────

    on(event, handler) {
        (this._handlers[event] || (this._handlers[event] = [])).push(handler);
        return this;
    }

    refresh() { this._scheduleRender(); return this; }

    destroy() {
        this._destroyed = true;
        this._resizeObserver.disconnect();
        this._eventController.abort();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _emit(event, data) { (this._handlers[event] || []).forEach(h => h(data)); }

    _setupCanvas() {
        const canvas = this._canvas;
        const resize = () => {
            canvas.width  = Math.round(canvas.clientWidth  * this._dpr);
            canvas.height = Math.round(canvas.clientHeight * this._dpr);
            this._scheduleRender();
        };
        this._resizeObserver = new ResizeObserver(resize);
        this._resizeObserver.observe(canvas);
        resize();
    }

    _setupEvents() {
        const canvas = this._canvas;
        const ac = this._eventController = new AbortController();
        const { signal } = ac;

        canvas.addEventListener('pointerdown', e => {
            if (e.button !== 0) return;
            canvas.setPointerCapture(e.pointerId);
            this._drag = {
                startX: e.clientX, startY: e.clientY,
                startPanX: this._viewport.panX,
                startPanY: this._viewport.panY,
            };
        }, { signal });

        canvas.addEventListener('pointermove', e => {
            if (this._drag) {
                this._viewport.panX = this._drag.startPanX + (e.clientX - this._drag.startX);
                this._viewport.panY = this._drag.startPanY + (e.clientY - this._drag.startY);
                this._scheduleRender();
                this._emit('viewportChange', this.getViewport());
            } else {
                const { row, col } = this._screenToOffset(e.clientX, e.clientY);
                if (row >= 0 && row < this._rows && col >= 0 && col < this._cols) {
                    this._emit('hexHover', { row, col });
                }
            }
        }, { signal });

        canvas.addEventListener('pointerup', e => {
            canvas.releasePointerCapture(e.pointerId);
            this._drag = null;
        }, { signal });

        canvas.addEventListener('pointercancel', e => {
            canvas.releasePointerCapture(e.pointerId);
            this._drag = null;
        }, { signal });

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const rect   = canvas.getBoundingClientRect();
            const px     = e.clientX - rect.left;
            const py     = e.clientY - rect.top;
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            const newZ   = Math.max(this._minZoom, Math.min(this._maxZoom, this._viewport.zoom * factor));
            this._applyZoom(newZ, px, py);
            this._emit('viewportChange', this.getViewport());
        }, { signal, passive: false });

        canvas.addEventListener('click', e => {
            const { row, col } = this._screenToOffset(e.clientX, e.clientY);
            if (row >= 0 && row < this._rows && col >= 0 && col < this._cols) {
                this._emit('hexClick', { row, col, button: e.button });
            }
        }, { signal });
    }

    // Zoom toward screen point (px, py) in CSS pixels
    _applyZoom(newZoom, px, py) {
        const { panX, panY, zoom, angle } = this._viewport;
        const dx = px - panX, dy = py - panY;
        const wx = (dx * Math.cos(-angle) - dy * Math.sin(-angle)) / zoom;
        const wy = (dx * Math.sin(-angle) + dy * Math.cos(-angle)) / zoom;
        this._viewport.zoom = newZoom;
        this._viewport.panX = px - newZoom * (wx * Math.cos(angle) - wy * Math.sin(angle));
        this._viewport.panY = py - newZoom * (wx * Math.sin(angle) + wy * Math.cos(angle));
        this._scheduleRender();
    }

    // Convert screen position (clientX/Y) → offset hex coords
    _screenToOffset(clientX, clientY) {
        const rect = this._canvas.getBoundingClientRect();
        const { panX, panY, zoom, angle } = this._viewport;
        const dx = (clientX - rect.left) - panX;
        const dy = (clientY - rect.top)  - panY;
        const wx = (dx * Math.cos(-angle) - dy * Math.sin(-angle)) / zoom;
        const wy = (dx * Math.sin(-angle) + dy * Math.cos(-angle)) / zoom;
        return Geometry.pixelToOffset(wx, wy, this._layout);
    }

    _scheduleRender() {
        if (!this._dirty) {
            this._dirty = true;
            requestAnimationFrame(() => this._render());
        }
    }

    _render() {
        if (this._destroyed) return;
        this._dirty = false;
        const canvas = this._canvas;
        const ctx    = this._ctx;
        const { panX, panY, zoom, angle } = this._viewport;

        // Reset to HiDPI base transform
        ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        if (this._background) {
            ctx.fillStyle = this._background;
            ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
        }

        ctx.save();
        ctx.translate(panX, panY);
        ctx.rotate(angle);
        ctx.scale(zoom, zoom);

        const visibleHexes = this._computeVisibleHexes();
        for (const layer of this._layers) {
            if (layer.visible) layer.render(ctx, this, visibleHexes);
        }

        ctx.restore();
    }

    _computeVisibleHexes() {
        const { panX, panY, zoom, angle } = this._viewport;
        const canvas = this._canvas;
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;

        // Rotate all four canvas corners into world space to get the AABB
        // of the rotated visible rectangle (conservative but correct for any angle)
        let minWx = Infinity, minWy = Infinity, maxWx = -Infinity, maxWy = -Infinity;
        for (const [sx, sy] of [[0, 0], [cw, 0], [cw, ch], [0, ch]]) {
            const dx = sx - panX, dy = sy - panY;
            const wx = (dx * Math.cos(-angle) - dy * Math.sin(-angle)) / zoom;
            const wy = (dx * Math.sin(-angle) + dy * Math.cos(-angle)) / zoom;
            if (wx < minWx) minWx = wx; if (wx > maxWx) maxWx = wx;
            if (wy < minWy) minWy = wy; if (wy > maxWy) maxWy = wy;
        }

        const margin = this._layout.size * 1.5;
        minWx -= margin; minWy -= margin; maxWx += margin; maxWy += margin;

        const result = [];
        const layout = this._layout;
        for (let row = 0; row < this._rows; row++) {
            for (let col = 0; col < this._cols; col++) {
                const { x, y } = Geometry.offsetToPixel(row, col, layout);
                if (x >= minWx && x <= maxWx && y >= minWy && y <= maxWy) {
                    const { q, r } = Geometry.offsetToAxial(row, col, layout.orientation, layout.parity);
                    result.push({ row, col, q, r, cx: x, cy: y });
                }
            }
        }
        return result;
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

window.HexViewer = {
    HexMap,
    Geometry,
    Layer,
    HexOutlineLayer,
    HexLabelLayer,
    CenterDotLayer,
    FLAT_TOP,
    POINTY_TOP,
    OFFSET_ODD,
    OFFSET_EVEN,
};

})();
