# hex-viewer

A plain HTML + JavaScript framework for viewing hex-based board game maps. No build step, no dependencies.

## Files

```
index.html              demo / reference implementation
demo-perf.html          performance demo (1000x1000 grid, 8000 counters, minimap)
src/
  hexviewer.js          core framework (exposes window.HexViewer)
  counter-layer.js      counter layer module (exposes window.HexViewer.Counter / CounterLayer)
```

Game-specific modules can be added under `src/` and loaded with additional `<script>` tags.

---

## Quick start

```html
<canvas id="map" style="width:100%;height:100vh;display:block"></canvas>
<script src="src/hexviewer.js"></script>
<script>
  const map = new HexViewer.HexMap(document.getElementById('map'), {
    rows: 20, cols: 30,
    hexSize: 40,
    orientation:  HexViewer.POINTY_TOP,
    offsetParity: HexViewer.OFFSET_ODD,
    originCorner: 'top-left',
  });
</script>
```

---

## HexMap

### Constructor

```js
new HexViewer.HexMap(canvasElement, options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `rows` | number | 10 | Number of rows |
| `cols` | number | 10 | Number of columns |
| `hexSize` | number | 40 | Hex radius in pixels (centre to corner) |
| `orientation` | constant | `POINTY_TOP` | `FLAT_TOP` or `POINTY_TOP` |
| `offsetParity` | constant | `OFFSET_ODD` | `OFFSET_ODD` or `OFFSET_EVEN` |
| `originCorner` | string | `'top-left'` | `'top-left'` or `'bottom-left'` |
| `getHexLabel` | function | `null` | `(row, col) => string`; default formats as `RRCC` |
| `background` | string | `null` | Canvas fill colour; `null` = transparent |
| `rotationStep` | number | 60 | Degrees per rotate step |
| `minZoom` | number | 0.1 | Minimum zoom level |
| `maxZoom` | number | 10 | Maximum zoom level |

### Viewport

```js
map.panTo(row, col)              // centre viewport on hex
map.setZoom(z)                   // set zoom level
map.fitToView()                  // fit entire map in viewport; resets rotation to 0
map.getViewport()                // returns { panX, panY, zoom, angle }
map.setViewport({ panX, panY, zoom, angle })
```

### Rotation

Rotation is in discrete steps. Positive steps = clockwise. Canvas centre stays fixed.

```js
map.rotateBy(steps)              // rotate N steps (e.g. +1, -1)
map.setRotation(angleDeg)        // set absolute angle, snapped to rotationStep
map.getRotation()                // returns current angle in degrees (0-359)
map.rotationStep = 60            // change step size at runtime
```

### Layers

Layers are rendered back-to-front. Built-in layers are added automatically in order: `hex-outline`, `hex-label`, `center-dot`.

```js
map.addLayer(layer)              // append layer (top of stack)
map.addLayer(layer, index)       // insert at position
map.removeLayer(name)            // remove by name
map.getLayer(name)               // retrieve layer object
map.setLayerVisible(name, bool)  // show / hide layer
map.getLayers()                  // returns ordered copy of layer array
```

When a layer is added, `layer.onAttach(hexMap)` is called. When removed or the map is destroyed, `layer.onDetach(hexMap)` is called. Layers can use these hooks to register and clean up their own event listeners.

### Colours

```js
map.background = '#f0ede0'                    // canvas background fill
map.getLayer('hex-outline').strokeStyle = '#888'
map.getLayer('hex-label').fillStyle     = '#222'
map.getLayer('center-dot').fillStyle    = '#222'
map.refresh()                                 // force redraw after property changes
```

### Events

```js
map.on('hexClick',       ({ row, col, button }) => {})
map.on('hexHover',       ({ row, col }) => {})
map.on('hexDoubleClick', ({ row, col }) => {})
map.on('viewportChange', ({ panX, panY, zoom, angle }) => {})

map.off('hexClick', handler)     // unsubscribe a specific handler
```

### Coordinate utilities

```js
map.screenToWorld(clientX, clientY)  // returns { wx, wy } in world space
map.getHexLabel(row, col)            // returns label string (uses override if set)
```

### Misc

```js
map.refresh()                    // schedule a redraw
map.destroy()                    // remove event listeners and resize observer
```

---

## Built-in layers

All built-in layers have a `visible` property (get/set) and a `name` string. Layers automatically skip rendering detail that would be sub-pixel at the current zoom level (labels, dots, counter effects).

### HexOutlineLayer (`'hex-outline'`)

```js
layer.strokeStyle = '#556677'    // border colour
layer.lineWidth   = 1            // width in CSS pixels (stays constant under zoom)
```

### HexLabelLayer (`'hex-label'`)

```js
layer.fillStyle = '#223344'
```

Label position: just inside the top flat edge (flat-top) or near the bottom vertex (pointy-top). Text rotates with the map. Automatically hidden when the rendered font size would be below ~6px.

### CenterDotLayer (`'center-dot'`)

```js
layer.fillStyle = '#334455'
```

Automatically hidden when the rendered dot would be sub-pixel.

### MinimapLayer (`'minimap'`)

An overlay drawn in screen space showing the full map extent and the current viewport position. Supports drag-to-navigate.

```js
new HexViewer.MinimapLayer(options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `width` | number | 200 | Minimap panel width in CSS pixels |
| `height` | number | 150 | Minimap panel height in CSS pixels |
| `margin` | number | 12 | Distance from canvas edge in CSS pixels |
| `corner` | string | `'bottom-right'` | `'top-left'`, `'top-right'`, `'bottom-left'`, or `'bottom-right'` |

The viewport indicator is drawn as a correctly rotated quadrilateral when the map is rotated. Clicking or dragging the minimap pans the viewport to the corresponding world position.

---

## Custom layers

Subclass `HexViewer.Layer`. The `render` method receives a canvas context already transformed to world space (pan, rotate, and zoom applied), plus an array of visible hexes.

```js
class TerrainLayer extends HexViewer.Layer {
  constructor(data) {
    super('terrain');
    this._data = data;
  }

  // Called when added to a HexMap (use to register canvas event listeners)
  onAttach(hexMap) {}

  // Called when removed or map is destroyed (use to clean up listeners)
  onDetach(hexMap) {}

  render(ctx, hexMap, visibleHexes) {
    const co = hexMap.cornerOffsets;
    for (const hex of visibleHexes) {
      ctx.fillStyle = this._data[hex.row][hex.col].color;
      const corners = HexViewer.Geometry.hexCorners(hex.cx, hex.cy, co);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

map.addLayer(new TerrainLayer(data), 0);  // insert below built-in layers
```

Each `hex` in `visibleHexes` has `{ row, col, q, r, cx, cy }` where `cx`/`cy` are the world-space centre coordinates and `q`/`r` are axial coordinates.

`hexMap.cornerOffsets` is a precomputed array of `{ dx, dy }` for the six corners. Use `HexViewer.Geometry.hexCorners(cx, cy, cornerOffsets)` to get the six corner points.

Layers that need to render in screen space (e.g. overlays) can reset the transform inside `render`:

```js
render(ctx, hexMap, visibleHexes) {
  ctx.save();
  ctx.setTransform(hexMap._dpr, 0, 0, hexMap._dpr, 0, 0);
  // draw in CSS-pixel space
  ctx.restore();
}
```

---

## Counter layer (`src/counter-layer.js`)

Load after `hexviewer.js`. Exposes `window.HexViewer.Counter` and `window.HexViewer.CounterLayer`.

```html
<script src="src/hexviewer.js"></script>
<script src="src/counter-layer.js"></script>
```

### Counter

```js
new HexViewer.Counter({ id, row, col, size, color })
```

| Property | Type | Default | Description |
|---|---|---|---|
| `id` | string | required | Unique identifier |
| `row` | number | required | Grid row |
| `col` | number | required | Grid column |
| `size` | string | `'large'` | `'large'` or `'small'` |
| `color` | string | `'#cc4444'` | Fill colour |

### CounterLayer

```js
const layer = new HexViewer.CounterLayer();
map.addLayer(layer);
```

| Property | Type | Default | Description |
|---|---|---|---|
| `largeScale` | number | 1.15 | Large counter side as a multiple of `hexSize` |
| `smallScale` | number | 0.85 | Small counter side as a multiple of `hexSize` |

```js
layer.addCounter(counter)        // add a Counter instance
layer.removeCounter(id)          // remove by id
layer.getSelected()              // returns Set of selected ids
layer.clearSelection()           // deselect all
layer.closeWarp()                // collapse warp-out view
```

**Stacking:** counters on the same hex are drawn as a stack — large counters below small counters, with a pixel offset to show depth. A badge shows the stack count when more than one counter is present.

**Warp-out:** double-clicking a stack with more than one counter spreads them horizontally above the hex with dashed leader lines. Click any warped counter to select/deselect it. Click outside the warp area to collapse it.

**Selection:** clicking the top counter of a stack (or any counter when warped) toggles a yellow selection border. Selection persists across warp open/close.

**3D depth effect:** shadow, highlight bevel, and shadow bevel strips are automatically suppressed when the counter would render smaller than ~14 CSS pixels wide.

---

## Geometry utilities

`HexViewer.Geometry` exposes pure functions for coordinate maths. Algorithms follow [redblobgames](https://www.redblobgames.com/grids/hexagons/).

```js
const G = HexViewer.Geometry;

G.offsetToAxial(row, col, orientation, parity)   // => { q, r }
G.axialToOffset(q, r, orientation, parity)        // => { row, col }
G.axialToPixel(q, r, layout)                      // => { x, y }  world space
G.pixelToAxial(px, py, layout)                    // => { q, r }
G.offsetToPixel(row, col, layout)                 // => { x, y }
G.pixelToOffset(px, py, layout)                   // => { row, col }
G.hexCorners(cx, cy, cornerOffsets)               // => [{ x, y }, ...]  6 points
G.cubeRound(fq, fr, fs)                           // => { q, r, s }
G.offsetNeighbors(row, col, orientation, parity)  // => [{ row, col }, ...]  6 neighbours
G.hexDistance(q1, r1, s1, q2, r2, s2)            // => number  (cube distance)
G.computeCornerOffsets(layout)                    // => [{ dx, dy }, ...]  precomputed
```

`layout` is the object returned by `map.layout` (`{ orientation, size, origin, parity, yFlip }`).

---

## Constants

```js
HexViewer.POINTY_TOP    // pointy-top orientation
HexViewer.FLAT_TOP      // flat-top orientation
HexViewer.OFFSET_ODD    // odd-row/col offset  (-1)
HexViewer.OFFSET_EVEN   // even-row/col offset (+1)
```

---

## Performance notes

The visible-hex computation uses the viewport AABB to estimate the row/col range before iterating, so only hexes near the visible area are checked. This keeps frame cost proportional to visible hexes rather than total grid size, making large grids (e.g. 1000x1000) interactive.

`demo-perf.html` provides a 1000x1000 grid with 8000 randomly placed counters and an FPS counter for benchmarking.
