# HexDetailsLayer — Design Document

## Overview

`HexDetailsLayer` provides per-hex and per-hex-edge property storage with optional custom
rendering. It is the terrain/feature data layer that a future hex-to-hex movement pathfinder
will consume. The layer itself contains no pathfinding logic; it exposes a clean data contract
that the pathfinder calls into.

---

## Requirements

### Functional

1. Store arbitrary properties (plain key-value object) on any hex.
2. Store arbitrary properties on any hex edge (the physical boundary shared by two adjacent hexes).
3. Support an optional user-supplied draw function that renders into each hex with properties.
4. Support an optional user-supplied draw function that renders each edge with properties.
5. Support both **complete** storage (every hex pre-allocated) and **sparse** storage (only hexes/edges that have been written).
6. Support serialisation (`toJSON` / `fromJSON`) for save/load.

The layer carries no movement-cost or passability semantics. Those are the responsibility of the
application-supplied cost function passed to the pathfinding module (see Pathfinding Integration).

### Performance

12. Skip all draw functions when `size × zoom` falls below a configurable threshold.
13. Render only visible hexes (use the `visibleHexes` list supplied by the render loop).
14. Avoid redundant double-drawing of shared edges (each physical edge drawn at most once per frame).
15. Sparse mode avoids allocating O(rows × cols) memory for mostly-empty maps.

### Out of scope for this layer

- Pathfinding algorithm implementation (separate module, added later).
- Unit position or movement state.
- Animation.
- Fog of war / visibility.

---

## Data Model

### Hex properties

A single plain object per hex, merged incrementally via `setHex`. The schema is entirely
application-defined. The only convention is that terrain-type keys provide the lookup value
the cost function uses to determine movement cost and passability:

```js
{
  terrain:   'forest',   // key used by the cost function
  elevation: 3,
  supply:    true,
}
```

### Edge properties

Each of the six edges of a hex is the physical boundary shared with one neighbour. Edge `e` of
hex `(r, c)` is the same physical edge as edge `(e + 3) % 6` of the neighbour in direction `e`.

Properties can be set from either hex's perspective. When querying an edge the two records are
**merged** (the queried hex's own record takes precedence on key conflicts). Example shape:

```js
{
  river:  true,
  road:   true,
  bridge: false,
}
```

All cost and passability decisions (impassable hexes, blocked or permitted crossings, road
bonuses, etc.) live in the application-supplied `costFn` passed to the pathfinder — not in
reserved property names on this layer.

### Storage modes

| Mode | Internal structure | Best for |
|---|---|---|
| `'sparse'` (default) | `Map<string, object>` | Most wargame maps (properties on minority of hexes) |
| `'complete'` | `rows × cols` 2-D array | Maps where every hex carries terrain data |

Complete mode requires `rows` and `cols` at construction. Sparse mode needs neither.

---

## API

### Constructor

```js
new HexViewer.HexDetailsLayer(name, options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `'sparse'` | `'sparse'` or `'complete'` |
| `rows`, `cols` | number | — | Required for `'complete'` mode |
| `drawHexFn` | function | `null` | `(ctx, hex, props, hexMap) => void` — render into hex |
| `drawEdgeFn` | function | `null` | `(ctx, edgeGeom, props, hexMap) => void` — render edge |
| `drawUnset` | boolean | `false` | In complete mode, call `drawHexFn` for hexes with no explicit props |
| `minScreenSize` | number | `4` | Skip draw functions when `size × zoom` is below this value |
| `visible` | boolean | `true` | Initial layer visibility |

### Hex operations

```js
layer.setHex(row, col, props)      // merge props into hex record; creates if absent
layer.getHex(row, col)             // → props object or null
layer.clearHex(row, col)           // delete hex record
layer.hasHex(row, col)             // → bool
layer.forEachHex(fn)               // fn(row, col, props) for every stored hex record
```

`setHex` uses `Object.assign` semantics — existing keys not mentioned in `props` are preserved.
To replace entirely, `clearHex` first.

### Edge operations

```js
layer.setEdge(row, col, edge, props)   // merge props into edge record for this hex's side
layer.getEdge(row, col, edge)          // → merged record (both sides), or null
layer.getEdgeOwn(row, col, edge)       // → only this hex's edge record, no neighbour merge
layer.clearEdge(row, col, edge)        // delete this hex's edge record
layer.hasEdge(row, col, edge)          // → bool; true if either side has a record
layer.forEachEdge(fn)                  // fn(row, col, edge, props) for every stored edge record
```

### Serialisation

```js
layer.toJSON()                          // → { hexes: [...], edges: [...] }
layer.fromJSON(data)                    // merge into existing data
layer.fromJSON(data, { replace: true }) // clear first, then load
```

The JSON payload contains only raw property data; draw functions and cost functions are not
serialised.

---

## Rendering Design

### drawHexFn

Called for each visible hex that has a non-null property record (or every visible hex in
complete mode when `drawUnset` is true). The canvas context is already in world space (pan,
rotation, zoom applied).

```js
drawHexFn(ctx, hex, props, hexMap)
// hex      — { row, col, q, r, cx, cy }  (same shape as visibleHexes entries)
// props    — the hex's merged property object (null in complete+drawUnset mode)
// hexMap   — HexMap instance; gives access to layout, cornerOffsets, viewport, etc.
```

### drawEdgeFn

Called for each visible edge with at least one property record. Pre-computed geometry is passed
so the function does not need to recompute trig.

```js
drawEdgeFn(ctx, edgeGeom, props, hexMap)
// edgeGeom — {
//   row, col, edge,           // canonical hex/edge identity
//   cx, cy,                   // world-space centre of the canonical hex
//   x0, y0,                   // world-space first corner
//   x1, y1,                   // world-space second corner
//   mx, my,                   // midpoint
//   nx, ny,                   // outward unit normal (points away from hex centre)
//   nbrRow, nbrCol,           // neighbour coordinates; -1 if off-grid
// }
// props    — merged edge record (own + neighbour, own takes precedence)
```

### Screen-size culling

```js
if (hexMap._layout.size * hexMap._viewport.zoom < this.minScreenSize) return;
```

Applied once at the top of `render`, before any iteration — same pattern as `HexOutlineLayer`.

### Edge deduplication

Each shared edge must be drawn at most once. Options:

**Option A — per-frame Set (clean, allocates once per frame):**

```js
const drawn = new Set();
for (const hex of visibleHexes) {
  for (let e = 0; e < 6; e++) {
    const key = this._canonicalEdgeKey(hex.row, hex.col, e);
    if (drawn.has(key)) continue;
    drawn.add(key);
    const props = this.getEdge(hex.row, hex.col, e);
    if (props) this.drawEdgeFn(ctx, this._edgeGeom(hex, e, hexMap), props, hexMap);
  }
}
```

**Option B — ownership rule (no allocation):**

Draw the edge from hex A only when A is the canonical owner (neighbour row > A's row, or same
row and neighbour col > A's col). Avoids the Set but requires the neighbour lookup for every
candidate edge slot even when no edge record exists.

Recommendation: start with Option A; switch to Option B if profiling shows the Set is a
bottleneck (unlikely for typical edge counts).

### Edge geometry caching

Corner offsets are already precomputed by `HexMap`. Midpoints and normals can be derived from
pairs of corner offsets and are the same for every hex given a fixed layout. These six values
should be computed once in `onAttach` and stored on the layer (`this._edgeGeomOffsets`), so
`drawEdgeFn` calls do no trig per frame.

```js
// Precomputed once per layout:
// edgeGeomOffsets[e] = { dmx, dmy, nx, ny }
// where (cx + dmx, cy + dmy) is the edge midpoint and (nx, ny) is the outward normal.
```

---

## Pathfinding Integration

The pathfinder (`hex-movement.js` or similar) is a separate module that:

1. Accepts a `HexDetailsLayer` as its terrain data source.
2. Accepts a `costFn` callback (application-supplied) and a `unitType` value (application-defined).
3. Optionally accepts additional context (e.g. a weather modifier) passed straight through to `costFn`.
4. Runs A* over the hex grid (hex centres as nodes, shared edges as transitions).
5. For each candidate transition calls `costFn`; infinite cost means the transition is blocked.
6. Returns an ordered array of `{row, col}` hex coordinates (the path), or `null` if unreachable.

### costFn signature

```js
costFn(fromRow, fromCol, toRow, toCol, edge, hexProps, edgeProps, unitType, context)
// → number | Infinity
```

| Parameter | Description |
|---|---|
| `fromRow, fromCol` | Origin hex coordinates |
| `toRow, toCol` | Destination hex coordinates |
| `edge` | Which of the 6 edges is being crossed (0–5) |
| `hexProps` | Property record of the **destination** hex (may be `null`) |
| `edgeProps` | Merged edge record for the shared boundary (may be `null`) |
| `unitType` | Application-defined value (plain object, string, etc.) |
| `context` | Optional extra data passed through from the `findPath` call (weather, supply, etc.) |

All passability and cost logic lives here. Return `Infinity` to block a transition entirely.

### Unit types

Unit types are plain objects defined by the application. The layer has no awareness of them.

```js
const ARMOR    = { name: 'armor',    wheeled: true,  naval: false };
const INFANTRY = { name: 'infantry', wheeled: false, naval: false };
const SHIP     = { name: 'ship',     wheeled: false, naval: true  };

function myCostFn(fromR, fromC, toR, toC, edge, hexProps, edgeProps, unitType, ctx) {
  const terrain = hexProps?.terrain ?? 'open';

  if (unitType.naval && terrain !== 'sea')  return Infinity;
  if (!unitType.naval && terrain === 'sea') return Infinity;

  // Base cost from terrain table (application-defined)
  let cost = TERRAIN_COST[unitType.name]?.[terrain] ?? 1;

  // Edge modifiers from edge properties
  if (edgeProps?.river && !edgeProps?.bridge) cost += unitType.wheeled ? 2 : 1;
  if (edgeProps?.road)                        cost  = Math.max(0.5, cost * 0.5);

  // Context modifier (e.g. weather)
  if (ctx?.weather === 'mud' && unitType.wheeled) cost *= 1.5;

  return cost;
}
```

### Pathfinder API sketch

```js
// findPath(layer, startRow, startCol, endRow, endCol, costFn, unitType, options)
// → [ {row, col}, … ] | null
//
// options.context — passed through to costFn as the last argument
// options.skipStartPassability — if true, costFn not called for the origin hex (unit
//   may already be on difficult terrain)
```

The pathfinder calls `layer.getHex` and `layer.getEdge` directly; it does not call any methods
on the layer that embed cost logic.

---

## Implementation Notes

### Internal key formats

| Data | Key format | Example |
|---|---|---|
| Hex record | `"${row},${col}"` | `"5,3"` |
| Edge record | `"${row},${col},${edge}"` | `"5,3,2"` |
| Canonical edge | derived from both hex keys | see below |

**Canonical edge key** for deduplication: after computing the neighbour `(nr, nc)` and its edge
`ne = (e + 3) % 6`, the canonical key is whichever of `"r,c,e"` and `"nr,nc,ne"` sorts
lexicographically first.

### `_neighbor(row, col, edge)` implementation

Requires the map layout. Store `this._hexMap` in `onAttach`:

```js
onAttach(hexMap) {
  this._hexMap = hexMap;
  this._precomputeEdgeGeomOffsets(hexMap);
}
onDetach() { this._hexMap = null; }
```

Neighbour lookup delegates to the existing `Geometry.offsetNeighbors`:

```js
_neighbor(row, col, edge) {
  if (!this._hexMap) return null;
  const { orientation, parity } = this._hexMap._layout;
  const nbrs = Geometry.offsetNeighbors(row, col, orientation, parity);
  const n = nbrs[edge];
  if (n.row < 0 || n.row >= this._hexMap._rows ||
      n.col < 0 || n.col >= this._hexMap._cols) return null;
  return n;
}
```

### Complete mode layout

```js
// Construction
this._hexGrid = Array.from({ length: rows }, () => new Array(cols).fill(null));

// setHex
if (!this._hexGrid[row][col]) this._hexGrid[row][col] = {};
Object.assign(this._hexGrid[row][col], props);

// getHex
return this._hexGrid[row][col];  // may be null
```

### `getEdge` merge

```js
getEdge(row, col, edge) {
  const own  = this._edgeData.get(`${row},${col},${edge}`) ?? null;
  const nbr  = this._neighbor(row, col, edge);
  const nbrKey = nbr ? `${nbr.row},${nbr.col},${(edge + 3) % 6}` : null;
  const other  = nbrKey ? (this._edgeData.get(nbrKey) ?? null) : null;
  if (!own && !other) return null;
  if (!other) return own;
  if (!own)   return other;
  return { ...other, ...own };   // own takes precedence on key conflicts
}
```

### forEachHex in complete mode

```js
forEachHex(fn) {
  if (this._mode === 'sparse') {
    for (const [key, props] of this._hexData) {
      const [row, col] = key.split(',').map(Number);
      fn(row, col, props);
    }
  } else {
    for (let r = 0; r < this._rows; r++)
      for (let c = 0; c < this._cols; c++)
        if (this._hexGrid[r][c]) fn(r, c, this._hexGrid[r][c]);
  }
}
```

---

## Decisions

1. **Edge merge semantics** — `getEdge` merges both sides; queried hex's record takes
   precedence on key conflicts. **Accepted.**

2. **Cost/passability semantics** — no reserved property names on the layer (`impassable`,
   `moveCost`, `crossableBy`, etc. are gone). All such logic lives in the application-supplied
   `costFn` passed to the pathfinder. **Accepted.**

3. **Edge deduplication** — Option A (per-frame `Set`). **Accepted.**

4. **`moveCost` default in pathfinder** — `costFn` should return `1` for hexes with no data
   (traversable at normal cost). Application responsibility. **Accepted.**

5. **Pathfinder location** — separate module (`src/hex-movement.js`). **Accepted.**

6. **Multiple layers** — API does not preclude it. Pathfinder takes a single layer; application
   merges data at the `costFn` level if multiple layers are needed. **Accepted.**

7. **Off-map neighbours** — `_neighbor` returns `null`; `getEdge` returns only the own record
   for boundary edges. **Correct behaviour; accepted.**

8. **`drawUnset` option** — `drawHexFn` called for hexes with no explicit props only when
   `drawUnset: true` (default `false`). **Accepted.**

9. **Edge geometry caching** — precompute six `{ dmx, dmy, nx, ny }` values in `onAttach`.
   **Do from the start.**
