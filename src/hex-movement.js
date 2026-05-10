/**
 * hex-movement.js — hex-grid pathfinding for HexViewer
 * Load after hexviewer.js. Adds findPath, reachableHexes, pathCost to window.HexViewer.
 */
(function () {
'use strict';

// ── Min-heap priority queue ────────────────────────────────────────────────────

class MinHeap {
    constructor() { this._h = []; }
    get size()    { return this._h.length; }

    push(priority, value) {
        this._h.push([priority, value]);
        this._up(this._h.length - 1);
    }

    pop() {
        const top  = this._h[0][1];
        const last = this._h.pop();
        if (this._h.length) { this._h[0] = last; this._down(0); }
        return top;
    }

    _up(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this._h[i][0] < this._h[p][0]) {
                [this._h[i], this._h[p]] = [this._h[p], this._h[i]]; i = p;
            } else break;
        }
    }

    _down(i) {
        for (;;) {
            const l = 2*i+1, r = 2*i+2;
            let m = i;
            if (l < this._h.length && this._h[l][0] < this._h[m][0]) m = l;
            if (r < this._h.length && this._h[r][0] < this._h[m][0]) m = r;
            if (m === i) break;
            [this._h[i], this._h[m]] = [this._h[m], this._h[i]]; i = m;
        }
    }
}

// ── Internal helpers ───────────────────────────────────────────────────────────

const Geometry = window.HexViewer.Geometry;

// Returns valid grid neighbours of (row, col) as [{row, col, edge}].
// edge is the cube-direction index (0–5) pointing from (row,col) toward the neighbour.
function gridNeighbors(row, col, hexMap) {
    const { orientation, parity } = hexMap._layout;
    const nbrs   = Geometry.offsetNeighbors(row, col, orientation, parity);
    const result = [];
    for (let e = 0; e < 6; e++) {
        const n = nbrs[e];
        if (n.row >= 0 && n.row < hexMap._rows && n.col >= 0 && n.col < hexMap._cols)
            result.push({ row: n.row, col: n.col, edge: e });
    }
    return result;
}

// ── findPath ──────────────────────────────────────────────────────────────────
//
// A* (h=0 by default → Dijkstra) from (startRow,startCol) to (endRow,endCol).
// Returns { path: [{row,col},...], cost: number } with both endpoints included,
// or null if the destination is unreachable.
//
// options:
//   context   — passed through to costFn as the last argument
//   heuristic — fn(fromRow,fromCol,toRow,toCol,hexMap)→number; must be admissible
//               (never exceed true remaining cost). Default: 0.
//
// costFn signature:
//   costFn(fromRow,fromCol,toRow,toCol,edge,hexProps,edgeProps,unitType,context)
//   → number | Infinity   (Infinity or negative blocks the transition)
//
function findPath(layer, startRow, startCol, endRow, endCol, costFn, unitType, options = {}) {
    const hexMap = layer._hexMap;
    if (!hexMap) throw new Error('findPath: layer is not attached to a HexMap');

    if (startRow === endRow && startCol === endCol)
        return { path: [{ row: startRow, col: startCol }], cost: 0 };

    const h       = options.heuristic ?? (() => 0);
    const context = options.context   ?? null;
    const startK  = `${startRow},${startCol}`;
    const endK    = `${endRow},${endCol}`;

    const dist = new Map([[startK, 0]]);
    const prev = new Map([[startK, null]]);
    const heap = new MinHeap();
    heap.push(h(startRow, startCol, endRow, endCol, hexMap), { row: startRow, col: startCol, g: 0 });

    while (heap.size > 0) {
        const { row, col, g } = heap.pop();
        const k = `${row},${col}`;

        if (g > (dist.get(k) ?? Infinity)) continue; // stale entry

        if (k === endK) {
            const path = [];
            let cur = k;
            while (cur !== null) {
                const [r, c] = cur.split(',').map(Number);
                path.push({ row: r, col: c });
                cur = prev.get(cur);
            }
            path.reverse();
            return { path, cost: g };
        }

        for (const { row: nr, col: nc, edge } of gridNeighbors(row, col, hexMap)) {
            const hexProps  = layer.getHex(nr, nc);
            const edgeProps = layer.getEdge(row, col, edge);
            const step      = costFn(row, col, nr, nc, edge, hexProps, edgeProps, unitType, context);
            if (!isFinite(step) || step < 0) continue;

            const ng = g + step;
            const nk = `${nr},${nc}`;
            if (ng < (dist.get(nk) ?? Infinity)) {
                dist.set(nk, ng);
                prev.set(nk, k);
                heap.push(ng + h(nr, nc, endRow, endCol, hexMap), { row: nr, col: nc, g: ng });
            }
        }
    }

    return null; // destination unreachable
}

// ── reachableHexes ────────────────────────────────────────────────────────────
//
// Dijkstra flood-fill from (startRow,startCol), collecting every hex reachable
// within maxCost movement points.
//
// Returns Map<"row,col", {row, col, cost}> including the origin at cost 0.
//
// options:
//   context — passed through to costFn
//
function reachableHexes(layer, startRow, startCol, maxCost, costFn, unitType, options = {}) {
    const hexMap = layer._hexMap;
    if (!hexMap) throw new Error('reachableHexes: layer is not attached to a HexMap');

    const context = options.context ?? null;
    const startK  = `${startRow},${startCol}`;

    const dist   = new Map([[startK, 0]]);
    const result = new Map([[startK, { row: startRow, col: startCol, cost: 0 }]]);
    const heap   = new MinHeap();
    heap.push(0, { row: startRow, col: startCol, cost: 0 });

    while (heap.size > 0) {
        const { row, col, cost } = heap.pop();
        const k = `${row},${col}`;
        if (cost > (dist.get(k) ?? Infinity)) continue;

        for (const { row: nr, col: nc, edge } of gridNeighbors(row, col, hexMap)) {
            const hexProps  = layer.getHex(nr, nc);
            const edgeProps = layer.getEdge(row, col, edge);
            const step      = costFn(row, col, nr, nc, edge, hexProps, edgeProps, unitType, context);
            if (!isFinite(step) || step < 0) continue;

            const newCost = cost + step;
            if (newCost > maxCost) continue;

            const nk = `${nr},${nc}`;
            if (newCost < (dist.get(nk) ?? Infinity)) {
                dist.set(nk, newCost);
                result.set(nk, { row: nr, col: nc, cost: newCost });
                heap.push(newCost, { row: nr, col: nc, cost: newCost });
            }
        }
    }

    return result;
}

// ── pathCost ──────────────────────────────────────────────────────────────────
//
// Computes the total movement cost of traversing a caller-supplied sequence of
// hexes. Each consecutive pair must be adjacent; non-adjacent steps or
// impassable transitions cause an early return with blocked:true.
//
// Returns { cost: number, blocked: boolean }.
//
function pathCost(layer, pathArray, costFn, unitType, options = {}) {
    const hexMap = layer._hexMap;
    if (!hexMap) throw new Error('pathCost: layer is not attached to a HexMap');
    if (!pathArray || pathArray.length < 2) return { cost: 0, blocked: false };

    const context = options.context ?? null;
    const { orientation, parity } = hexMap._layout;
    let total = 0;

    for (let i = 0; i < pathArray.length - 1; i++) {
        const { row: r1, col: c1 } = pathArray[i];
        const { row: r2, col: c2 } = pathArray[i + 1];

        // Find which cube-direction edge connects (r1,c1) to (r2,c2)
        const nbrs = Geometry.offsetNeighbors(r1, c1, orientation, parity);
        let edge = -1;
        for (let e = 0; e < 6; e++) {
            if (nbrs[e].row === r2 && nbrs[e].col === c2) { edge = e; break; }
        }
        if (edge === -1) return { cost: Infinity, blocked: true }; // non-adjacent

        const hexProps  = layer.getHex(r2, c2);
        const edgeProps = layer.getEdge(r1, c1, edge);
        const step      = costFn(r1, c1, r2, c2, edge, hexProps, edgeProps, unitType, context);
        if (!isFinite(step)) return { cost: Infinity, blocked: true };
        total += step;
    }

    return { cost: total, blocked: false };
}

// ── Exports ───────────────────────────────────────────────────────────────────

Object.assign(window.HexViewer, { findPath, reachableHexes, pathCost });

})();
