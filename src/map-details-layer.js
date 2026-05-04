// map-details-layer.js - connectors and hex-edge borders
// Requires hexviewer.js to be loaded first (uses window.HexViewer).
//
// addConnector({ from, to, fromOffset, toOffset, width, color, alpha, dash })
//   Draws a straight line between two hex centres, optionally pulled back
//   fromOffset world-units at the start and toOffset world-units at the end.
//
// addBorder({ row, col, edge, width, color, alpha, dash })
//   Draws a single hex edge. edge is 0-5 clockwise from corner 0.
//
// addBorderSegments(segments, sharedStyle)
//   Batch helper. segments are [{row, col, edge}, ...].

(function () {
    'use strict';
    const { Layer, Geometry } = window.HexViewer;

    class MapDetailsLayer extends Layer {
        constructor(name = 'map-details') {
            super(name);
            this._connectors = [];
            this._borders    = [];
        }

        addConnector({ from, to, fromOffset = 0, toOffset = 0,
                       width = 2, color = '#ffffff', alpha = 1.0, dash = [] }) {
            this._connectors.push({ from, to, fromOffset, toOffset, width, color, alpha, dash });
            if (this._hexMap) this._hexMap.refresh();
            return this;
        }

        addBorder({ row, col, edge, width = 2, color = '#ffffff', alpha = 1.0, dash = [] }) {
            this._borders.push({ row, col, edge, width, color, alpha, dash });
            if (this._hexMap) this._hexMap.refresh();
            return this;
        }

        addBorderSegments(segments, { width = 2, color = '#ffffff', alpha = 1.0, dash = [] } = {}) {
            for (const { row, col, edge } of segments) {
                this._borders.push({ row, col, edge, width, color, alpha, dash });
            }
            if (this._hexMap) this._hexMap.refresh();
            return this;
        }

        clearAll() {
            this._connectors = [];
            this._borders    = [];
            if (this._hexMap) this._hexMap.refresh();
        }

        render(ctx, hexMap) {
            this._renderConnectors(ctx, hexMap);
            this._renderBorders(ctx, hexMap);
        }

        // -- Private --------------------------------------------------------------

        _renderConnectors(ctx, hexMap) {
            for (const c of this._connectors) {
                const A  = Geometry.offsetToPixel(c.from.row, c.from.col, hexMap._layout);
                const B  = Geometry.offsetToPixel(c.to.row,   c.to.col,   hexMap._layout);
                const dx = B.x - A.x, dy = B.y - A.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len < 1e-9) continue;
                const ux = dx / len, uy = dy / len;
                const ax = A.x + ux * c.fromOffset, ay = A.y + uy * c.fromOffset;
                const bx = B.x - ux * c.toOffset,   by = B.y - uy * c.toOffset;
                ctx.save();
                ctx.globalAlpha = c.alpha;
                ctx.strokeStyle = c.color;
                ctx.lineWidth   = c.width;
                ctx.setLineDash(c.dash);
                ctx.beginPath();
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        _renderBorders(ctx, hexMap) {
            const co = hexMap.cornerOffsets;
            for (const b of this._borders) {
                const { x, y } = Geometry.offsetToPixel(b.row, b.col, hexMap._layout);
                const v2 = (b.edge + 1) % 6;
                ctx.save();
                ctx.globalAlpha = b.alpha;
                ctx.strokeStyle = b.color;
                ctx.lineWidth   = b.width;
                ctx.lineCap     = 'round';
                ctx.setLineDash(b.dash);
                ctx.beginPath();
                ctx.moveTo(x + co[b.edge].dx, y + co[b.edge].dy);
                ctx.lineTo(x + co[v2].dx,     y + co[v2].dy);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }
    }

    window.HexViewer.MapDetailsLayer = MapDetailsLayer;
})();
