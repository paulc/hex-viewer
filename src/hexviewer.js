(function () {
'use strict';

// -- Orientation constants (redblobgames) --------------------------------------

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

// -- Geometry namespace (pure functions) ---------------------------------------

const Geometry = {

    // Offset -> axial. Uses Math.trunc (not Math.floor) for negative-coord safety.
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

// -- Layer base class ----------------------------------------------------------

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

    onAttach(_hexMap) {}
    onDetach(_hexMap) {}

    // Override in subclasses. ctx is already in world space (pan/rotate/zoom applied).
    render(_ctx, _hexMap, _visibleHexes) {}
}

// -- Built-in layers -----------------------------------------------------------

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
        if (size * 0.28 * hexMap._viewport.zoom < 6) return; // too small to read
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
        const radius = hexMap._layout.size * 0.03;
        if (radius * hexMap._viewport.zoom < 0.8) return; // sub-pixel, skip
        ctx.fillStyle = this.fillStyle;
        for (const hex of visibleHexes) {
            ctx.beginPath();
            ctx.arc(hex.cx, hex.cy, radius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

// -- DomLayer / PanelLayer -----------------------------------------------------

// Base class for layers that live in the DOM overlay rather than the canvas.
// The overlay root is a pointer-events:none div that covers the canvas exactly.
// Subclasses can set pointer-events:auto on individual child elements to make
// them interactive while leaving the rest of the canvas unblocked.
class DomLayer extends Layer {
    constructor(name, visible = true) {
        super(name, visible);
        this._el = document.createElement('div');
        this._el.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
        if (!visible) this._el.style.display = 'none';
    }

    // Override visible so toggling updates the DOM element (no canvas redraw needed).
    get visible() { return this._visible; }
    set visible(v) {
        this._visible = !!v;
        this._el.style.display = v ? '' : 'none';
    }

    // Direct access to the full-size overlay container element.
    get element() { return this._el; }

    onAttach(hexMap) {
        hexMap._overlayRoot.appendChild(this._el);
        // Re-order all DOM-layer elements to match the _layers stack order.
        for (const layer of hexMap._layers) {
            if (layer._el && layer._el.parentNode === hexMap._overlayRoot) {
                hexMap._overlayRoot.appendChild(layer._el);
            }
        }
    }

    onDetach(_hexMap) {
        this._el.remove();
    }

    // DOM layers do not participate in the canvas render loop.
    render(_ctx, _hexMap, _visibleHexes) {}
}

// A pre-styled, absolutely positioned panel for displaying game information.
class PanelLayer extends DomLayer {
    constructor(name, options = {}) {
        super(name, options.visible !== false);

        const panel = document.createElement('div');
        panel.style.cssText = [
            'position:absolute',
            'box-sizing:border-box',
            'pointer-events:auto',
            'background:rgba(10,20,30,0.82)',
            'border:1px solid #4a6a88',
            'border-radius:4px',
            'padding:8px 12px',
            'color:#c8d8e8',
            'font-family:monospace',
            'font-size:13px',
            'min-width:80px',
        ].join(';');
        this._panel = panel;
        this._el.appendChild(panel);

        if (options.position) this.setPosition(options.position);
        if (options.html !== undefined) this.html = options.html;
    }

    // Set panel position within the canvas area.
    // Each value is a CSS length string or a number (treated as px); omit sides to leave unset.
    setPosition({ top, right, bottom, left } = {}) {
        const px = v => v === undefined ? '' : (typeof v === 'number' ? v + 'px' : v);
        const s = this._panel.style;
        s.top    = px(top);
        s.right  = px(right);
        s.bottom = px(bottom);
        s.left   = px(left);
        return this;
    }

    // Set panel dimensions. Values are CSS strings or numbers (px).
    setSize({ width, height } = {}) {
        const px = v => typeof v === 'number' ? v + 'px' : v;
        if (width  !== undefined) this._panel.style.width  = px(width);
        if (height !== undefined) this._panel.style.height = px(height);
        return this;
    }

    // Set or replace the panel's HTML content.
    set html(content) { this._panel.innerHTML = content; }

    // Direct access to the panel element for arbitrary DOM manipulation.
    get panelElement() { return this._panel; }
}

// -- MinimapLayer --------------------------------------------------------------

class MinimapLayer extends Layer {
    constructor(options = {}) {
        super('minimap');
        this._mmW    = options.width  || 200;
        this._mmH    = options.height || 150;
        this._margin = options.margin || 12;
        this._corner = options.corner || 'bottom-right';
        this._dragging  = false;
        this._mapBounds = null;

        this._onDown = this._onDown.bind(this);
        this._onMove = this._onMove.bind(this);
        this._onUp   = this._onUp.bind(this);
    }

    onAttach(hexMap) {
        this._mapBounds = null; // recompute for new map geometry
        const c = hexMap._canvas;
        c.addEventListener('pointerdown', this._onDown, { capture: true });
        c.addEventListener('pointermove', this._onMove, { capture: true });
        c.addEventListener('pointerup',   this._onUp,   { capture: true });
    }

    onDetach(hexMap) {
        const c = hexMap._canvas;
        c.removeEventListener('pointerdown', this._onDown, { capture: true });
        c.removeEventListener('pointermove', this._onMove, { capture: true });
        c.removeEventListener('pointerup',   this._onUp,   { capture: true });
    }

    render(ctx, hexMap, _visibleHexes) {
        const dpr = hexMap._dpr;
        const cw  = hexMap._canvas.clientWidth;
        const ch  = hexMap._canvas.clientHeight;
        const { mx, my } = this._mmPos(cw, ch);
        const mw = this._mmW, mh = this._mmH;

        const bounds = this._bounds(hexMap);
        const bw = bounds.maxX - bounds.minX;
        const bh = bounds.maxY - bounds.minY;
        // Uniform scale so the whole map fits inside the minimap with 4px padding
        const pad  = 4;
        const sc   = Math.min((mw - pad * 2) / bw, (mh - pad * 2) / bh);
        const ox   = mx + (mw - bw * sc) / 2;
        const oy   = my + (mh - bh * sc) / 2;
        const toMX = wx => ox + (wx - bounds.minX) * sc;
        const toMY = wy => oy + (wy - bounds.minY) * sc;

        // Cache for hit-test and drag
        this._mm = { mx, my, mw, mh, ox, oy, sc, bounds };

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Panel background + border
        ctx.fillStyle = 'rgba(8,18,28,0.88)';
        ctx.fillRect(mx, my, mw, mh);

        // Clip map contents to panel
        ctx.save();
        ctx.beginPath();
        ctx.rect(mx, my, mw, mh);
        ctx.clip();

        // Map area
        ctx.fillStyle = '#c8c0b0';
        ctx.fillRect(toMX(bounds.minX), toMY(bounds.minY), bw * sc, bh * sc);

        // Viewport rectangle (rotated quad in world space -> minimap)
        const { panX, panY, zoom, angle } = hexMap._viewport;
        const corners = [[0,0],[cw,0],[cw,ch],[0,ch]].map(([sx, sy]) => {
            const dx = sx - panX, dy = sy - panY;
            return {
                wx: (dx * Math.cos(-angle) - dy * Math.sin(-angle)) / zoom,
                wy: (dx * Math.sin(-angle) + dy * Math.cos(-angle)) / zoom,
            };
        });

        ctx.fillStyle   = 'rgba(106,176,216,0.22)';
        ctx.strokeStyle = '#6ab0d8';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(toMX(corners[0].wx), toMY(corners[0].wy));
        for (let i = 1; i < 4; i++) ctx.lineTo(toMX(corners[i].wx), toMY(corners[i].wy));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore(); // end clip

        // Panel border drawn after clip restore so it's not clipped
        ctx.strokeStyle = '#4a6a88';
        ctx.lineWidth   = 1;
        ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);

        ctx.restore(); // end screen-space transform
    }

    // -- Private ---------------------------------------------------------------

    _mmPos(cw, ch) {
        const { _mmW: w, _mmH: h, _margin: m, _corner: corner } = this;
        switch (corner) {
            case 'top-left':     return { mx: m,        my: m };
            case 'top-right':    return { mx: cw - w - m, my: m };
            case 'bottom-left':  return { mx: m,        my: ch - h - m };
            default:             return { mx: cw - w - m, my: ch - h - m };
        }
    }

    _bounds(hexMap) {
        if (this._mapBounds) return this._mapBounds;
        const layout = hexMap._layout;
        const rows = hexMap._rows, cols = hexMap._cols;
        // Sample 8 strategic points: 4 corners + 4 edge midpoints
        const samples = [
            [0,0],[0,cols-1],[rows-1,0],[rows-1,cols-1],
            [0,cols>>1],[rows-1,cols>>1],[rows>>1,0],[rows>>1,cols-1],
        ];
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        for (const [r,c] of samples) {
            const {x,y} = Geometry.offsetToPixel(r, c, layout);
            if (x<minX)minX=x; if (x>maxX)maxX=x;
            if (y<minY)minY=y; if (y>maxY)maxY=y;
        }
        const pad = layout.size * 1.5;
        this._mapBounds = { minX:minX-pad, minY:minY-pad, maxX:maxX+pad, maxY:maxY+pad };
        return this._mapBounds;
    }

    _screenPos(clientX, clientY) {
        const rect = this._hexMap._canvas.getBoundingClientRect();
        return { sx: clientX - rect.left, sy: clientY - rect.top };
    }

    _inMinimap(sx, sy) {
        if (!this._mm) return false;
        const { mx, my, mw, mh } = this._mm;
        return sx >= mx && sx <= mx + mw && sy >= my && sy <= my + mh;
    }

    _panTo(sx, sy) {
        const { ox, oy, sc, bounds } = this._mm;
        const wx = bounds.minX + (sx - ox) / sc;
        const wy = bounds.minY + (sy - oy) / sc;
        const hm = this._hexMap;
        const { zoom, angle } = hm._viewport;
        const cw = hm._canvas.clientWidth  / 2;
        const ch = hm._canvas.clientHeight / 2;
        hm._viewport.panX = cw - zoom * (wx * Math.cos(angle) - wy * Math.sin(angle));
        hm._viewport.panY = ch - zoom * (wx * Math.sin(angle) + wy * Math.cos(angle));
        hm._scheduleRender();
        hm._emit('viewportChange', hm.getViewport());
    }

    _onDown(e) {
        if (!this.visible || !this._hexMap) return;
        const { sx, sy } = this._screenPos(e.clientX, e.clientY);
        if (!this._inMinimap(sx, sy)) return;
        e.stopImmediatePropagation();
        this._dragging = true;
        this._hexMap._canvas.setPointerCapture(e.pointerId);
        this._panTo(sx, sy);
    }

    _onMove(e) {
        if (!this._dragging) return;
        e.stopImmediatePropagation();
        const { sx, sy } = this._screenPos(e.clientX, e.clientY);
        this._panTo(sx, sy);
    }

    _onUp(e) {
        if (!this._dragging) return;
        this._dragging = false;
        this._hexMap._canvas.releasePointerCapture(e.pointerId);
    }
}

// -- HexMap --------------------------------------------------------------------

class HexMap {
    constructor(canvas, options = {}) {
        this._canvas    = canvas;
        this._ctx       = canvas.getContext('2d');
        this._dpr       = window.devicePixelRatio || 1;
        this._destroyed = false;

        // Wrap the canvas in a relative-positioned div so absolutely-positioned
        // DOM overlay layers can be placed over it without affecting page layout.
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;width:100%;height:100%;display:block;overflow:hidden;';
        canvas.parentNode.insertBefore(wrapper, canvas);
        wrapper.appendChild(canvas);

        const overlayRoot = document.createElement('div');
        overlayRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
        wrapper.appendChild(overlayRoot);

        this._wrapper     = wrapper;
        this._overlayRoot = overlayRoot;

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

    // -- Public accessors ----------------------------------------------------

    get layout()        { return this._layout; }
    get cornerOffsets() { return this._cornerOffsets; }

    get background()    { return this._background; }
    set background(c)   { this._background = c; this._scheduleRender(); }

    get rotationStep()  { return this._rotationStep; }
    set rotationStep(s) { this._rotationStep = Math.max(1, Math.abs(s)); }

    getHexLabel(row, col) { return this._getHexLabel(row, col); }

    // -- Layer management ----------------------------------------------------

    addLayer(layer, index) {
        layer._hexMap = this;
        if (index === undefined) this._layers.push(layer);
        else this._layers.splice(index, 0, layer);
        layer.onAttach(this);
        this._scheduleRender();
        return this;
    }

    removeLayer(name) {
        const idx = this._layers.findIndex(l => l.name === name);
        if (idx !== -1) {
            this._layers[idx].onDetach(this);
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
        if (layer) { layer.visible = !!visible; this._scheduleRender(); }
        return this;
    }

    // -- Viewport ------------------------------------------------------------

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
        // Only check border hexes - interior can't extend beyond them
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

    // -- Rotation (configurable step, default 60deg) ----------------------------

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

    // -- Events ----------------------------------------------------------------

    on(event, handler) {
        (this._handlers[event] || (this._handlers[event] = [])).push(handler);
        return this;
    }

    off(event, handler) {
        const hs = this._handlers[event];
        if (hs) { const i = hs.indexOf(handler); if (i !== -1) hs.splice(i, 1); }
        return this;
    }

    screenToWorld(clientX, clientY) {
        const rect = this._canvas.getBoundingClientRect();
        const { panX, panY, zoom, angle } = this._viewport;
        const dx = (clientX - rect.left) - panX;
        const dy = (clientY - rect.top)  - panY;
        return {
            wx: (dx * Math.cos(-angle) - dy * Math.sin(-angle)) / zoom,
            wy: (dx * Math.sin(-angle) + dy * Math.cos(-angle)) / zoom,
        };
    }

    refresh() { this._scheduleRender(); return this; }

    destroy() {
        this._destroyed = true;
        for (const layer of this._layers) { layer.onDetach(this); layer._hexMap = null; }
        this._layers = [];
        this._resizeObserver.disconnect();
        this._eventController.abort();
        // Unwrap: move canvas back to where the wrapper was, then remove the wrapper
        this._wrapper.parentNode.insertBefore(this._canvas, this._wrapper);
        this._wrapper.remove();
    }

    // -- Private ---------------------------------------------------------------

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

        canvas.addEventListener('dblclick', e => {
            const { row, col } = this._screenToOffset(e.clientX, e.clientY);
            if (row >= 0 && row < this._rows && col >= 0 && col < this._cols) {
                this._emit('hexDoubleClick', { row, col });
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

    // Convert screen position (clientX/Y) -> offset hex coords
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

        // Estimate which rows and cols could be visible so we don't scan the whole grid.
        // Row/col step sizes are exact for the primary axis; the +2 pad covers stagger.
        const { size, orientation, yFlip } = this._layout;
        const isPointy = orientation === POINTY_TOP;
        const rowStep = isPointy ? size * 1.5          : size * Math.sqrt(3);
        const colStep = isPointy ? size * Math.sqrt(3) : size * 1.5;
        const pad = 2;

        let r0, r1;
        if (yFlip >= 0) {
            r0 = Math.floor(minWy / rowStep) - pad;
            r1 = Math.ceil(maxWy / rowStep)  + pad;
        } else {
            r0 = Math.floor(-maxWy / rowStep) - pad;
            r1 = Math.ceil(-minWy / rowStep)  + pad;
        }
        const rowMin = Math.max(0, r0);
        const rowMax = Math.min(this._rows - 1, r1);
        const colMin = Math.max(0, Math.floor(minWx / colStep) - pad);
        const colMax = Math.min(this._cols - 1, Math.ceil(maxWx / colStep) + pad);

        const result = [];
        const layout = this._layout;
        for (let row = rowMin; row <= rowMax; row++) {
            for (let col = colMin; col <= colMax; col++) {
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

// -- Exports -------------------------------------------------------------------

window.HexViewer = {
    HexMap,
    Geometry,
    Layer,
    HexOutlineLayer,
    HexLabelLayer,
    CenterDotLayer,
    DomLayer,
    PanelLayer,
    MinimapLayer,
    FLAT_TOP,
    POINTY_TOP,
    OFFSET_ODD,
    OFFSET_EVEN,
};

})();
