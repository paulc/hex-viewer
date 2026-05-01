// image-layer.js - image layers that move with the hex map
// Requires hexviewer.js to be loaded first (uses window.HexViewer).
//
// Three modes:
//   'fill'   - stretch the image to cover the entire hex grid extent
//   'anchor' - place the image at a specific world position or hex centre
//   'tile'   - repeat the image across the visible area at a fixed world size
//
// All modes clip to the visible viewport before drawing so only the visible
// portion of the image is sent to the GPU each frame.

(function () {
    const { Layer, Geometry } = window.HexViewer;

    class ImageLayer extends Layer {
        // image  : HTMLImageElement | HTMLCanvasElement | ImageBitmap | URL string
        // options:
        //   mode        : 'fill' | 'anchor' | 'tile'   (default 'fill')
        //   alpha       : 0-1                           (default 1)
        //   visible     : boolean                       (default true)
        //
        //   anchor/fill-only:
        //     x, y      : world-space top-left of image (default 0, 0)
        //     row, col  : hex to centre the image on (overrides x/y)
        //     width, height : image extent in world units
        //                     (default: image pixel size × scale)
        //     scale     : pixels-to-world-units multiplier  (default 1)
        //
        //   tile-only:
        //     tileWidth, tileHeight : world-unit size per tile
        //                             (default: image pixel dimensions)
        //     originX, originY      : world-space tiling origin (default 0, 0)
        constructor(name, image, options = {}) {
            super(name, options.visible !== false);
            this.alpha = options.alpha !== undefined ? options.alpha : 1;
            this.mode  = options.mode  || 'fill';
            this._opts = options;
            this._img  = null;
            this._bounds = null;  // cached map bounding box (fill mode)

            if (typeof image === 'string') {
                const el = new Image();
                el.onload = () => { this._img = el; this._hexMap && this._hexMap.refresh(); };
                el.onerror = () => console.warn(`ImageLayer '${name}': failed to load ${image}`);
                el.src = image;
            } else {
                this._img = image;
            }
        }

        onAttach(_hexMap) {
            this._bounds = null;
        }

        onDetach(_hexMap) {
            this._bounds = null;
        }

        render(ctx, hexMap, _visibleHexes) {
            if (!this._img || this.alpha <= 0) return;
            ctx.save();
            ctx.globalAlpha = this.alpha;
            if      (this.mode === 'fill')   this._renderFill(ctx, hexMap);
            else if (this.mode === 'anchor') this._renderAnchor(ctx, hexMap);
            else if (this.mode === 'tile')   this._renderTile(ctx, hexMap);
            ctx.restore();
        }

        // -- Fill: stretch to cover the full grid extent ----------------------

        _renderFill(ctx, hexMap) {
            const b   = this._getMapBounds(hexMap);
            const vis = this._visibleBounds(hexMap);

            // Intersect image rect with visible area — only draw what's on screen
            const x0 = Math.max(b.x, vis.x0), y0 = Math.max(b.y, vis.y0);
            const x1 = Math.min(b.x + b.w, vis.x1), y1 = Math.min(b.y + b.h, vis.y1);
            if (x0 >= x1 || y0 >= y1) return;

            const img = this._img;
            ctx.drawImage(img,
                (x0 - b.x) / b.w * img.width,  (y0 - b.y) / b.h * img.height,
                (x1 - x0)  / b.w * img.width,  (y1 - y0)  / b.h * img.height,
                x0, y0, x1 - x0, y1 - y0);
        }

        // -- Anchor: placed at explicit world coords or centred on a hex ------

        _renderAnchor(ctx, hexMap) {
            const opts = this._opts;
            const img  = this._img;
            const sc   = opts.scale || 1;
            const w    = opts.width  || img.width  * sc;
            const h    = opts.height || img.height * sc;
            let wx, wy;

            if (opts.row !== undefined && opts.col !== undefined) {
                const p = Geometry.offsetToPixel(opts.row, opts.col, hexMap._layout);
                wx = p.x - w / 2;
                wy = p.y - h / 2;
            } else {
                wx = opts.x || 0;
                wy = opts.y || 0;
            }

            const vis = this._visibleBounds(hexMap);
            const x0 = Math.max(wx, vis.x0), y0 = Math.max(wy, vis.y0);
            const x1 = Math.min(wx + w, vis.x1), y1 = Math.min(wy + h, vis.y1);
            if (x0 >= x1 || y0 >= y1) return;

            ctx.drawImage(img,
                (x0 - wx) / w * img.width,  (y0 - wy) / h * img.height,
                (x1 - x0) / w * img.width,  (y1 - y0) / h * img.height,
                x0, y0, x1 - x0, y1 - y0);
        }

        // -- Tile: repeat across the visible area, only drawing visible tiles -

        _renderTile(ctx, hexMap) {
            const opts = this._opts;
            const img  = this._img;
            const tw   = opts.tileWidth  || img.width;
            const th   = opts.tileHeight || img.height;
            const ox   = opts.originX || 0;
            const oy   = opts.originY || 0;
            const vis  = this._visibleBounds(hexMap);

            // Tile indices that overlap the visible window
            const c0 = Math.floor((vis.x0 - ox) / tw);
            const c1 = Math.ceil( (vis.x1 - ox) / tw);
            const r0 = Math.floor((vis.y0 - oy) / th);
            const r1 = Math.ceil( (vis.y1 - oy) / th);

            for (let r = r0; r <= r1; r++)
                for (let c = c0; c <= c1; c++)
                    ctx.drawImage(img, ox + c * tw, oy + r * th, tw, th);
        }

        // -- Helpers ----------------------------------------------------------

        // Returns the visible world-space AABB by mapping the four canvas
        // corners through the inverse viewport transform.
        _visibleBounds(hexMap) {
            const { panX, panY, zoom, angle } = hexMap._viewport;
            const dpr  = hexMap._dpr;
            const cssW = hexMap._canvas.width  / dpr;
            const cssH = hexMap._canvas.height / dpr;
            const cos  = Math.cos(-angle), sin = Math.sin(-angle);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [sx, sy] of [[0,0],[cssW,0],[cssW,cssH],[0,cssH]]) {
                const dx = sx - panX, dy = sy - panY;
                const wx = (dx * cos - dy * sin) / zoom;
                const wy = (dx * sin + dy * cos) / zoom;
                if (wx < x0) x0 = wx;
                if (wy < y0) y0 = wy;
                if (wx > x1) x1 = wx;
                if (wy > y1) y1 = wy;
            }
            return { x0, y0, x1, y1 };
        }

        // Computes and caches the world-space AABB of the full hex grid by
        // sampling corner points of the boundary hexes (including their corners,
        // not just centres, so the bounding box is pixel-accurate).
        _getMapBounds(hexMap) {
            if (this._bounds) return this._bounds;
            const layout = hexMap._layout;
            const rows   = hexMap._rows;
            const cols   = hexMap._cols;
            const co     = hexMap.cornerOffsets;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

            for (const [r, c] of [
                [0, 0],           [0, cols - 1],
                [rows - 1, 0],    [rows - 1, cols - 1],
                [0, cols >> 1],   [rows - 1, cols >> 1],
                [rows >> 1, 0],   [rows >> 1, cols - 1],
            ]) {
                const { x: cx, y: cy } = Geometry.offsetToPixel(r, c, layout);
                for (const { dx, dy } of co) {
                    const x = cx + dx, y = cy + dy;
                    if (x < x0) x0 = x;
                    if (y < y0) y0 = y;
                    if (x > x1) x1 = x;
                    if (y > y1) y1 = y;
                }
            }
            return (this._bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
    }

    window.HexViewer.ImageLayer = ImageLayer;
})();
