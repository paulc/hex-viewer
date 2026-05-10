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
        this.strokeStyle   = options.strokeStyle   || '#556677';
        this.lineWidth     = options.lineWidth      || 1;
        this.minScreenSize = options.minScreenSize  ?? 8;
    }

    render(ctx, hexMap, visibleHexes) {
        if (hexMap._layout.size * hexMap._viewport.zoom < this.minScreenSize) return;
        const co = hexMap.cornerOffsets;
        ctx.strokeStyle = this.strokeStyle;
        // Compensate lineWidth for zoom so outlines stay 1 CSS-pixel wide
        ctx.lineWidth = this.lineWidth / hexMap._viewport.zoom;
        ctx.beginPath();
        for (const hex of visibleHexes) {
            ctx.moveTo(hex.cx + co[0].dx, hex.cy + co[0].dy);
            for (let i = 1; i < 6; i++) ctx.lineTo(hex.cx + co[i].dx, hex.cy + co[i].dy);
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

// -- HexDetailsLayer -----------------------------------------------------------

class HexDetailsLayer extends Layer {
    constructor(name, options = {}) {
        super(name, options.visible !== false);
        const {
            mode          = 'sparse',
            rows,
            cols,
            drawHexFn     = null,
            drawEdgeFn    = null,
            drawUnset     = false,
            minScreenSize = 4,
        } = options;

        this._mode         = mode;
        this._rows         = rows ?? 0;
        this._cols         = cols ?? 0;
        this._drawHexFn    = drawHexFn;
        this._drawEdgeFn   = drawEdgeFn;
        this._drawUnset    = drawUnset;
        this.minScreenSize = minScreenSize;

        if (mode === 'complete') {
            if (!rows || !cols) throw new Error('HexDetailsLayer: complete mode requires rows and cols');
            this._hexGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));
        } else {
            this._hexData = new Map();
        }
        this._edgeData        = new Map();
        this._edgeGeomOffsets = null;
    }

    // -- Lifecycle ---------------------------------------------------------------

    onAttach(hexMap) {
        this._hexMap = hexMap;
        this._precomputeEdgeGeomOffsets(hexMap);
    }

    onDetach() {
        this._hexMap          = null;
        this._edgeGeomOffsets = null;
    }

    // -- Hex operations ----------------------------------------------------------

    setHex(row, col, props) {
        if (this._mode === 'sparse') {
            const key      = `${row},${col}`;
            const existing = this._hexData.get(key);
            if (existing) Object.assign(existing, props);
            else          this._hexData.set(key, Object.assign({}, props));
        } else {
            if (!this._hexGrid[row][col]) this._hexGrid[row][col] = {};
            Object.assign(this._hexGrid[row][col], props);
        }
        if (this._hexMap) this._hexMap._scheduleRender();
        return this;
    }

    getHex(row, col) {
        if (this._mode === 'sparse') return this._hexData.get(`${row},${col}`) ?? null;
        if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) return null;
        return this._hexGrid[row][col];
    }

    clearHex(row, col) {
        if (this._mode === 'sparse') {
            this._hexData.delete(`${row},${col}`);
        } else {
            if (row >= 0 && row < this._rows && col >= 0 && col < this._cols)
                this._hexGrid[row][col] = null;
        }
        if (this._hexMap) this._hexMap._scheduleRender();
        return this;
    }

    hasHex(row, col) {
        if (this._mode === 'sparse') return this._hexData.has(`${row},${col}`);
        if (row < 0 || row >= this._rows || col < 0 || col >= this._cols) return false;
        return this._hexGrid[row][col] !== null;
    }

    forEachHex(fn) {
        if (this._mode === 'sparse') {
            for (const [key, props] of this._hexData) {
                const i = key.indexOf(',');
                fn(+key.slice(0, i), +key.slice(i + 1), props);
            }
        } else {
            for (let r = 0; r < this._rows; r++)
                for (let c = 0; c < this._cols; c++)
                    if (this._hexGrid[r][c]) fn(r, c, this._hexGrid[r][c]);
        }
    }

    // -- Edge operations ---------------------------------------------------------

    setEdge(row, col, edge, props) {
        const key      = `${row},${col},${edge}`;
        const existing = this._edgeData.get(key);
        if (existing) Object.assign(existing, props);
        else          this._edgeData.set(key, Object.assign({}, props));
        if (this._hexMap) this._hexMap._scheduleRender();
        return this;
    }

    getEdge(row, col, edge) {
        const own   = this._edgeData.get(`${row},${col},${edge}`) ?? null;
        const nbr   = this._neighborCoords(row, col, edge);
        const other = nbr ? (this._edgeData.get(`${nbr.row},${nbr.col},${(edge + 3) % 6}`) ?? null) : null;
        if (!own && !other) return null;
        if (!other) return own;
        if (!own)   return other;
        return { ...other, ...own };
    }

    getEdgeOwn(row, col, edge) {
        return this._edgeData.get(`${row},${col},${edge}`) ?? null;
    }

    clearEdge(row, col, edge) {
        this._edgeData.delete(`${row},${col},${edge}`);
        if (this._hexMap) this._hexMap._scheduleRender();
        return this;
    }

    hasEdge(row, col, edge) {
        if (this._edgeData.has(`${row},${col},${edge}`)) return true;
        const nbr = this._neighborCoords(row, col, edge);
        return nbr ? this._edgeData.has(`${nbr.row},${nbr.col},${(edge + 3) % 6}`) : false;
    }

    forEachEdge(fn) {
        for (const [key, props] of this._edgeData) {
            const i1 = key.indexOf(',');
            const i2 = key.indexOf(',', i1 + 1);
            fn(+key.slice(0, i1), +key.slice(i1 + 1, i2), +key.slice(i2 + 1), props);
        }
    }

    // -- Serialisation -----------------------------------------------------------

    toJSON() {
        const hexes = [], edges = [];
        this.forEachHex((row, col, props) => hexes.push({ row, col, props: { ...props } }));
        this.forEachEdge((row, col, edge, props) => edges.push({ row, col, edge, props: { ...props } }));
        return { hexes, edges };
    }

    fromJSON(data, options = {}) {
        if (options.replace) {
            if (this._mode === 'sparse') {
                this._hexData.clear();
            } else {
                for (let r = 0; r < this._rows; r++)
                    for (let c = 0; c < this._cols; c++)
                        this._hexGrid[r][c] = null;
            }
            this._edgeData.clear();
        }
        for (const { row, col, props }            of (data.hexes ?? [])) this.setHex(row, col, props);
        for (const { row, col, edge, props }      of (data.edges ?? [])) this.setEdge(row, col, edge, props);
        return this;
    }

    // -- Render ------------------------------------------------------------------

    render(ctx, hexMap, visibleHexes) {
        if (hexMap._layout.size * hexMap._viewport.zoom < this.minScreenSize) return;

        if (this._drawHexFn) {
            for (const hex of visibleHexes) {
                const props = this.getHex(hex.row, hex.col);
                if (props !== null || this._drawUnset) {
                    this._drawHexFn(ctx, hex, props, hexMap);
                }
            }
        }

        if (this._drawEdgeFn && this._edgeData.size > 0) {
            const drawn = new Set();
            for (const hex of visibleHexes) {
                for (let e = 0; e < 6; e++) {
                    const key = this._canonicalEdgeKey(hex.row, hex.col, e);
                    if (drawn.has(key)) continue;
                    drawn.add(key);
                    const props = this.getEdge(hex.row, hex.col, e);
                    if (props) this._drawEdgeFn(ctx, this._buildEdgeGeom(hex, e), props, hexMap);
                }
            }
        }
    }

    // -- Private -----------------------------------------------------------------

    _neighborCoords(row, col, edge) {
        if (!this._hexMap) return null;
        const { orientation, parity } = this._hexMap._layout;
        const axial = Geometry.offsetToAxial(row, col, orientation, parity);
        const d     = CUBE_DIRECTIONS[edge];
        const n     = Geometry.axialToOffset(axial.q + d.q, axial.r + d.r, orientation, parity);
        if (n.row < 0 || n.row >= this._hexMap._rows ||
            n.col < 0 || n.col >= this._hexMap._cols) return null;
        return n;
    }

    _canonicalEdgeKey(row, col, edge) {
        const nbr = this._neighborCoords(row, col, edge);
        if (!nbr) return `${row},${col},${edge}`;
        const nr = nbr.row, nc = nbr.col, ne = (edge + 3) % 6;
        if (row < nr || (row === nr && col < nc) || (row === nr && col === nc && edge < ne))
            return `${row},${col},${edge}`;
        return `${nr},${nc},${ne}`;
    }

    _precomputeEdgeGeomOffsets(hexMap) {
        const co = hexMap.cornerOffsets;
        this._edgeGeomOffsets = Array.from({ length: 6 }, (_, e) => {
            const e1  = (e + 1) % 6;
            const dmx = (co[e].dx + co[e1].dx) / 2;
            const dmy = (co[e].dy + co[e1].dy) / 2;
            // Outward unit normal: perpendicular to edge vector, pointing away from center
            const ex  = co[e1].dx - co[e].dx;
            const ey  = co[e1].dy - co[e].dy;
            let nx = -ey, ny = ex;
            if (nx * dmx + ny * dmy < 0) { nx = ey; ny = -ex; }
            const len = Math.sqrt(nx * nx + ny * ny);
            return { dmx, dmy, nx: nx / len, ny: ny / len };
        });
    }

    _buildEdgeGeom(hex, e) {
        const co  = this._hexMap.cornerOffsets;
        const off = this._edgeGeomOffsets[e];
        const e1  = (e + 1) % 6;
        const nbr = this._neighborCoords(hex.row, hex.col, e);
        return {
            row: hex.row,            col: hex.col,            edge: e,
            x0:  hex.cx + co[e].dx,  y0: hex.cy + co[e].dy,
            x1:  hex.cx + co[e1].dx, y1: hex.cy + co[e1].dy,
            mx:  hex.cx + off.dmx,   my: hex.cy + off.dmy,
            nx:  off.nx,             ny: off.ny,
            nbrRow: nbr ? nbr.row : -1,
            nbrCol: nbr ? nbr.col : -1,
        };
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
            origin       = { x: 0, y: 0 },
            startRow     = 0,
            startCol     = 0,
            getHexLabel  = null,
            minZoom      = 0.1,
            maxZoom      = 10,
            background   = null,
            rotationStep = 60,
        } = options;

        this._rows         = rows;
        this._cols         = cols;
        this._startRow     = startRow;
        this._startCol     = startCol;
        this._minZoom      = minZoom;
        this._maxZoom      = maxZoom;
        this._background   = background;
        this._rotationStep = rotationStep;

        this._layout = {
            orientation,
            size:   hexSize,
            origin: { x: origin.x ?? 0, y: origin.y ?? 0 },
            parity: offsetParity,
            yFlip:  originCorner === 'bottom-left' ? -1 : 1,
        };

        this._cornerOffsets = Geometry.computeCornerOffsets(this._layout);

        const sr = startRow, sc = startCol;
        this._getHexLabel = getHexLabel || ((row, col) =>
            `${String(col + sc).padStart(2, '0')}${String(row + sr).padStart(2, '0')}`
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
        const cw = this._canvas.clientWidth;
        const ch = this._canvas.clientHeight;

        // AABB of the rotated viewport in world space
        let minWx = Infinity, minWy = Infinity, maxWx = -Infinity, maxWy = -Infinity;
        const cosA = Math.cos(-angle), sinA = Math.sin(-angle);
        for (let ci = 0; ci < 4; ci++) {
            const sx = ci === 1 || ci === 2 ? cw : 0;
            const sy = ci === 2 || ci === 3 ? ch : 0;
            const dx = sx - panX, dy = sy - panY;
            const wx = (dx * cosA - dy * sinA) / zoom;
            const wy = (dx * sinA + dy * cosA) / zoom;
            if (wx < minWx) minWx = wx; if (wx > maxWx) maxWx = wx;
            if (wy < minWy) minWy = wy; if (wy > maxWy) maxWy = wy;
        }

        const { size, orientation, parity, yFlip } = this._layout;
        const ox = this._layout.origin.x, oy = this._layout.origin.y;
        const margin = size * 1.5;
        minWx -= margin; minWy -= margin; maxWx += margin; maxWy += margin;

        const isPointy = orientation === POINTY_TOP;
        const rowStep  = isPointy ? size * 1.5 : size * Math.sqrt(3);
        const colStep  = isPointy ? size * Math.sqrt(3) : size * 1.5;
        const pad = 2;

        let r0, r1;
        if (yFlip >= 0) {
            r0 = Math.floor((minWy - oy) / rowStep) - pad;
            r1 = Math.ceil( (maxWy - oy) / rowStep) + pad;
        } else {
            r0 = Math.floor(-(maxWy - oy) / rowStep) - pad;
            r1 = Math.ceil( -(minWy - oy) / rowStep) + pad;
        }
        const rowMin = Math.max(0, r0);
        const rowMax = Math.min(this._rows - 1, r1);
        const colMin = Math.max(0, Math.floor((minWx - ox) / colStep) - pad);
        const colMax = Math.min(this._cols - 1, Math.ceil((maxWx - ox) / colStep) + pad);

        const result = [];

        if (isPointy) {
            // POINTY_TOP: f = [√3, √3/2, 0, 3/2]
            // q = col - trunc((row + parity*(row&1)) / 2),  r = row
            // cx = √3·size·q + √3/2·size·row + ox  →  f0s·col + rowOffset (constant per row)
            // cy = yFlip·1.5·size·row + oy          (constant per row)
            const sqrt3  = Math.sqrt(3);
            const f0s    = sqrt3 * size;
            const f1s    = sqrt3 * 0.5 * size;
            const f3s    = 1.5 * size;
            for (let row = rowMin; row <= rowMax; row++) {
                const cy = yFlip * f3s * row + oy;
                if (cy < minWy || cy > maxWy) continue;
                const halfRow   = Math.trunc((row + parity * (row & 1)) / 2);
                const rowOffset = f1s * row - f0s * halfRow + ox;
                for (let col = colMin; col <= colMax; col++) {
                    const cx = f0s * col + rowOffset;
                    if (cx >= minWx && cx <= maxWx) {
                        result.push({ row, col, q: col - halfRow, r: row, cx, cy });
                    }
                }
            }
        } else {
            // FLAT_TOP: f = [3/2, 0, √3/2, √3]
            // q = col,  r = row - trunc((col + parity*(col&1)) / 2)
            // cx = 1.5·size·col + ox                (constant per col)
            // cy = yFlip·(√3/2·size·col + √3·size·r) + oy  →  yFlip·f3s·row + colOffset (const per col)
            const sqrt3  = Math.sqrt(3);
            const f0s    = 1.5 * size;
            const f2s    = sqrt3 * 0.5 * size;
            const f3s    = sqrt3 * size;
            for (let col = colMin; col <= colMax; col++) {
                const cx = f0s * col + ox;
                if (cx < minWx || cx > maxWx) continue;
                const halfCol   = Math.trunc((col + parity * (col & 1)) / 2);
                const colOffset = yFlip * (f2s * col - f3s * halfCol) + oy;
                for (let row = rowMin; row <= rowMax; row++) {
                    const cy = yFlip * f3s * row + colOffset;
                    if (cy >= minWy && cy <= maxWy) {
                        result.push({ row, col, q: col, r: row - halfCol, cx, cy });
                    }
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
    HexDetailsLayer,
    DomLayer,
    PanelLayer,
    MinimapLayer,
    FLAT_TOP,
    POINTY_TOP,
    OFFSET_ODD,
    OFFSET_EVEN,
};

})();
