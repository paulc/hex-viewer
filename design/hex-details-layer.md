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
6. Allow hexes to be marked impassable (hard block — no movement type can enter).
7. Allow edges to be marked impassable (hard block — can't cross the boundary).
8. Allow an edge to explicitly **permit** crossing that would otherwise be blocked by a hex or adjacent edge (e.g. a gate through a wall, a ford through an impassable river).
9. Expose a movement-cost / passability contract for the pathfinding module.
10. Support unit types with different movement characteristics via pluggable cost functions; unit type definitions live in application code, not in this layer.
11. Support serialisation (`toJSON` / `fromJSON`) for save/load.

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

A single plain object per hex, merged incrementally via `setHex`. Example shape (no fixed
schema — entirely application-defined):

```js
{
  terrain:    'forest',  // application tag
  elevation:  3,
  moveCost:   2,         // base cost to enter this hex
  impassable: false,     // hard block; overrides all other movement rules
  supply:     true,
}
```

### Edge properties

Each of the six edges of a hex is the physical boundary shared with one neighbour. Edge `e` of
hex `(r, c)` is the same physical edge as edge `(e + 3) % 6` of the neighbour in direction `e`.

Properties can be set from either hex's perspective. When querying an edge the two records are
**merged** (the queried hex's own record takes precedence on key conflicts). Example shape:

```js
{
  river:         true,
  road:          true,
  impassable:    false,  // hard block — can't cross from either side
  crossableBy:   ['infantry'],  // override: these types CAN cross even if impassable
  moveCostMod:   1,      // added to hex moveCost when crossing this edge
}
```

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

### Pathfinding data contract

These are the three methods the pathfinding module will call. Default implementations use the
`impassable` and `moveCost` properties with no unit-type differentiation. Replace by assigning
to the corresponding `*Fn` property.

```js
// Is hex (row, col) enterable by unitType?
layer.hexPassable(row, col, unitType)
// → bool; default: props == null || !props.impassable

// Can unitType cross the edge between (row,col) and its neighbour in direction `edge`?
layer.edgeCrossable(row, col, edge, unitType)
// → bool; default: !(ownProps?.impassable || neighbourProps?.impassable)

// Total movement cost for unitType to move from (fromRow,fromCol) to (toRow,toCol) via `edge`.
// Returns Infinity when movement is not possible.
layer.moveCost(fromRow, fromCol, toRow, toCol, edge, unitType)
// → number | Infinity
```

Override by replacing the pluggable functions:

```js
layer.hexPassableFn   = (row, col, props, unitType) => bool
layer.edgeCrossableFn = (row, col, edge, ownProps, nbrProps, unitType) => bool
layer.moveCostFn      = (fromRow, fromCol, toRow, toCol, edge,
                         destHexProps, edgeProps, unitType) => number | Infinity
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

The future pathfinder (`hex-movement.js` or similar) will be a separate module that:

1. Accepts a `HexDetailsLayer` as its terrain data source.
2. Accepts a `unitType` argument (plain object or string; the layer's pluggable functions interpret it).
3. Runs A* over the hex grid (hex centres as nodes, shared edges as transitions).
4. For each candidate transition calls `layer.moveCost(from, to, edge, unitType)`.
5. Returns an ordered array of `{row, col}` hex coordinates (the path), or `null` if unreachable.

### Unit types

Unit types are plain objects defined by the application. The layer does not maintain a registry.

```js
const ARMOR    = { name: 'armor',    wheeled: true,  naval: false };
const INFANTRY = { name: 'infantry', wheeled: false, naval: false };
const SHIP     = { name: 'ship',     wheeled: false, naval: true  };

layer.moveCostFn = (fromR, fromC, toR, toC, edge, hexProps, edgeProps, unitType) => {
  if (hexProps?.impassable)                        return Infinity;
  if (unitType.naval && hexProps?.terrain !== 'sea') return Infinity;
  if (!unitType.naval && hexProps?.terrain === 'sea') return Infinity;

  let cost = hexProps?.moveCost ?? 1;

  // Edge effects
  const ep = edgeProps ?? {};
  if (ep.impassable && !ep.crossableBy?.includes(unitType.name)) return Infinity;
  if (ep.river  && !ep.bridge) cost += unitType.wheeled ? 2 : 1;
  if (ep.road)                 cost  = Math.max(0.5, cost * 0.5);

  return cost;
};
```

### Edge-level passability override

```js
// A wall edge that infantry can pass through via a gate
layer.setEdge(5, 3, 2, { impassable: true, crossableBy: ['infantry'] });

layer.edgeCrossableFn = (row, col, edge, ownProps, nbrProps, unitType) => {
  const ep = { ...nbrProps, ...ownProps };
  if (!ep.impassable) return true;
  return ep.crossableBy?.includes(unitType.name) ?? false;
};
```

### Pathfinder start/end on impassable hexes

A unit that is already on an impassable hex (e.g. placed there by the scenario editor) should
still be able to find a path out. The pathfinder must skip the `hexPassable` check for the
origin hex, and optionally for the destination (the unit is trying to reach it regardless).

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

## Open Questions

1. **Edge deduplication strategy**: Option A (per-frame Set) vs Option B (ownership rule).
   Option A is simpler to reason about; Option B avoids a heap allocation per frame. Given
   that typical edge counts are low (borders, rivers etc. on a minority of hex edges), the Set
   is unlikely to be a bottleneck. **Recommend Option A** unless profiling says otherwise.

2. **`drawHexFn` in complete mode with null props**: Should the function be called for every
   hex including those with `null` records, or only when a record exists? Controlled by
   `drawUnset` option. Default `false` seems right — if every hex needs drawing the user can
   write a custom layer instead.

3. **Edge geometry caching**: Midpoints and normals are the same for every hex (same layout).
   Precompute six `{ dmx, dmy, nx, ny }` values in `onAttach`. This is straightforward and
   should be done from the start, not as a later optimisation.

4. **`moveCost` when no records exist**: Default should return `1` (passable, unit cost), not
   `0` or `Infinity`. A hex with no terrain data is assumed traversable with normal cost.

5. **Pathfinder location**: Keep as a separate module (`src/hex-movement.js`) rather than
   embedding in `HexDetailsLayer`. The layer is data + rendering; the pathfinder is a consumer.
   This keeps the layer usable without loading the pathfinder.

6. **Multiple layers**: Could there be more than one `HexDetailsLayer` on a single map (e.g.
   one for terrain, one for weather effects)? The API should not preclude this, but the
   pathfinder will need to know which layer(s) to query. Simplest: pathfinder takes a single
   layer; user merges layers at the application level if needed.

7. **Off-map neighbours**: `_neighbor` returns `null` for edges that touch the grid boundary.
   Edge records on boundary hexes pointing outward are stored but `getEdge` will only return
   the own record (no neighbour to merge from). This is correct behaviour.
