# hex-viewer

A plain HTML + JavaScript framework for viewing hex-based board game maps. No build step, no dependencies.

## Files

```
index.html          demo / reference implementation
src/
  hexviewer.js      core framework (exposes window.HexViewer)
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
map.getRotation()                // returns current angle in degrees (0–359)
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
map.on('viewportChange', ({ panX, panY, zoom, angle }) => {})
```

### Misc

```js
map.getHexLabel(row, col)        // returns label string (uses override if set)
map.refresh()                    // schedule a redraw
map.destroy()                    // remove event listeners and resize observer
```

---

## Built-in layers

All built-in layers have a `visible` property (get/set) and a `name` string.

### HexOutlineLayer (`'hex-outline'`)

```js
layer.strokeStyle = '#556677'    // border colour
layer.lineWidth   = 1            // width in CSS pixels (stays constant under zoom)
```

### HexLabelLayer (`'hex-label'`)

```js
layer.fillStyle = '#223344'
```

Label position: just inside the top flat edge (flat-top) or near the bottom vertex (pointy-top). Text rotates with the map.

### CenterDotLayer (`'center-dot'`)

```js
layer.fillStyle = '#334455'
```

---

## Custom layers

Subclass `HexViewer.Layer`. The `render` method receives a canvas context already transformed to world space (pan, rotate, and zoom applied), plus an array of visible hexes.

```js
class TerrainLayer extends HexViewer.Layer {
  constructor(data) {
    super('terrain');
    this._data = data;
  }

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
