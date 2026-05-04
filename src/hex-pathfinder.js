// hex-pathfinder.js - A* shortest path between two hex corners along hex edges.
// Requires hexviewer.js to be loaded first.
//
// findPath(fromSpec, toSpec, hexMap)
//   fromSpec / toSpec : { row, col, vertex }  — corner index 0-5.
//   Returns [{row, col, edge}, ...] suitable for addBorderSegments,
//   [] if start === end, or null if no path exists.

(function () {
    'use strict';
    const { Geometry } = window.HexViewer;

    // -------------------------------------------------------------------------
    // Min-heap keyed on node.f

    class MinHeap {
        constructor() { this._d = []; }
        get size()    { return this._d.length; }

        push(node) {
            this._d.push(node);
            let i = this._d.length - 1;
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (this._d[p].f <= this._d[i].f) break;
                [this._d[i], this._d[p]] = [this._d[p], this._d[i]];
                i = p;
            }
        }

        pop() {
            const top  = this._d[0];
            const last = this._d.pop();
            if (this._d.length) {
                this._d[0] = last;
                let i = 0;
                for (;;) {
                    let m = i;
                    const l = 2 * i + 1, r = l + 1;
                    if (l < this._d.length && this._d[l].f < this._d[m].f) m = l;
                    if (r < this._d.length && this._d[r].f < this._d[m].f) m = r;
                    if (m === i) break;
                    [this._d[i], this._d[m]] = [this._d[m], this._d[i]];
                    i = m;
                }
            }
            return top;
        }
    }

    // -------------------------------------------------------------------------
    // Vertex helpers

    // Stable position key: rounds to 0.01 world-units to survive floating point.
    function posKey(x, y) {
        return `${Math.round(x * 100)},${Math.round(y * 100)}`;
    }

    function cornerWorld(row, col, v, layout, co) {
        const { x, y } = Geometry.offsetToPixel(row, col, layout);
        return { x: x + co[v].dx, y: y + co[v].dy };
    }

    // Returns the (up to 3) graph neighbours of vertex (row, col, v).
    // Each entry: { row, col, v, x, y, pk, edgeSpec: {row, col, edge} }
    function getNeighbors(row, col, v, hexMap) {
        const { _layout: L, cornerOffsets: co, _rows: rows, _cols: cols } = hexMap;
        const { x: ox, y: oy } = cornerWorld(row, col, v, L, co);
        const result = [];

        const add = (r, c, nv, edgeSpec) => {
            const { x, y } = cornerWorld(r, c, nv, L, co);
            result.push({ row: r, col: c, v: nv, x, y, pk: posKey(x, y), edgeSpec });
        };

        // Two neighbours within the current hex
        add(row, col, (v + 1) % 6, { row, col, edge: v           });
        add(row, col, (v + 5) % 6, { row, col, edge: (v + 5) % 6 });

        // Third neighbour: the vertex shared by the two hexes adjacent to this
        // corner. Scan all hex neighbours; when a corner coincides with ours,
        // follow that hex's outward edge to the new vertex.
        const hexNbrs = Geometry.offsetNeighbors(row, col, L.orientation, L.parity);
        for (const nh of hexNbrs) {
            if (nh.row < 0 || nh.row >= rows || nh.col < 0 || nh.col >= cols) continue;
            const { x: nhx, y: nhy } = Geometry.offsetToPixel(nh.row, nh.col, L);
            for (let nv = 0; nv < 6; nv++) {
                const dx = nhx + co[nv].dx - ox, dy = nhy + co[nv].dy - oy;
                if (dx * dx + dy * dy < 1e-6) {
                    add(nh.row, nh.col, (nv + 1) % 6,
                        { row: nh.row, col: nh.col, edge: nv });
                    break;
                }
            }
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // A*

    function findPath(fromSpec, toSpec, hexMap) {
        const { _layout: L, cornerOffsets: co } = hexMap;

        const sp = cornerWorld(fromSpec.row, fromSpec.col, fromSpec.vertex, L, co);
        const gp = cornerWorld(toSpec.row,   toSpec.col,   toSpec.vertex,   L, co);
        const sk = posKey(sp.x, sp.y);
        const gk = posKey(gp.x, gp.y);

        if (sk === gk) return [];

        const h = (x, y) => Math.hypot(x - gp.x, y - gp.y);

        // visited: posKey → { parentKey, edgeSpec }
        const visited = new Map();
        const heap    = new MinHeap();

        visited.set(sk, { parentKey: null, edgeSpec: null });
        heap.push({ f: h(sp.x, sp.y), g: 0, pk: sk,
                    row: fromSpec.row, col: fromSpec.col, v: fromSpec.vertex });

        while (heap.size > 0) {
            const cur = heap.pop();
            if (cur.pk === gk) break;

            for (const nb of getNeighbors(cur.row, cur.col, cur.v, hexMap)) {
                if (visited.has(nb.pk)) continue;
                const g = cur.g + L.size;
                visited.set(nb.pk, { parentKey: cur.pk, edgeSpec: nb.edgeSpec });
                heap.push({ f: g + h(nb.x, nb.y), g, pk: nb.pk,
                            row: nb.row, col: nb.col, v: nb.v });
            }
        }

        if (!visited.has(gk)) return null;

        const path = [];
        let key = gk;
        while (key !== sk) {
            const { parentKey, edgeSpec } = visited.get(key);
            path.push(edgeSpec);
            key = parentKey;
        }
        path.reverse();
        return path;
    }

    window.HexViewer.findPath = findPath;
})();
