# hex-viewer

A plain HTML + JavaScript framework for viewing hex-based board game maps. No build step, no dependencies.

## Files

```
index.html              demo / reference implementation
demo-perf.html          performance demo (1000x1000 grid, 24000 counters, minimap)
demo-details.html       terrain and edge properties demo (HexDetailsLayer)
src/
  hexviewer.js          core framework (exposes window.HexViewer)
  counter-layer.js      counter layer module (exposes window.HexViewer.Counter / CounterLayer)
  image-layer.js        image layer module (exposes window.HexViewer.ImageLayer)
  map-details-layer.js  connectors and hex-edge borders (exposes window.HexViewer.MapDetailsLayer)
  hex-pathfinder.js     A* path along hex edges (exposes window.HexViewer.findPath)
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
| `origin` | object | `{ x:0, y:0 }` | World-space pixel offset applied to all hex positions |
| `startRow` | number | 0 | Row number of the first row (offsets default labels and reported coordinates) |
| `startCol` | number | 0 | Column number of the first column |
| `getHexLabel` | function | `null` | `(row, col) => string`; default formats as `CCRR` (zero-padded col then row) |
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
layer.strokeStyle   = '#556677'  // border colour
layer.lineWidth     = 1          // width in CSS pixels (stays constant under zoom)
layer.minScreenSize = 8          // skip rendering when hex radius (size × zoom) is below this threshold
```

`minScreenSize` is the hex radius in screen pixels below which outlines are not drawn. Set to `0` to always draw; increase it to hide borders sooner when zooming out, which significantly reduces draw call count for dense grids. Accepted at construction time via `options.minScreenSize`.

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

### HexDetailsLayer

Per-hex and per-hex-edge property storage with optional custom rendering. Intended as the data layer for terrain, features, and edge modifiers (rivers, roads, walls, etc.).

```js
new HexViewer.HexDetailsLayer(name, options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `'sparse'` | `'sparse'` (Map-backed) or `'complete'` (2-D array) |
| `rows`, `cols` | number | — | Required for `'complete'` mode |
| `drawHexFn` | function | `null` | `(ctx, hex, props, hexMap) => void` — render into each hex |
| `drawEdgeFn` | function | `null` | `(ctx, edgeGeom, props, hexMap) => void` — render each edge |
| `drawUnset` | boolean | `false` | In complete mode, call `drawHexFn` for hexes with no explicit props |
| `minScreenSize` | number | `4` | Skip draw functions when `size × zoom` is below this value |
| `visible` | boolean | `true` | Initial visibility |

`'sparse'` mode stores only hexes/edges that have been written. `'complete'` mode pre-allocates a `rows × cols` grid, which is faster to read back but uses more memory.

#### Hex operations

```js
layer.setHex(row, col, props)   // merge props into hex record (Object.assign semantics)
layer.getHex(row, col)          // → props object or null
layer.clearHex(row, col)        // delete hex record
layer.hasHex(row, col)          // → bool
layer.forEachHex(fn)            // fn(row, col, props) for every stored hex record
```

#### Edge operations

Each physical edge is shared by two adjacent hexes. Edge `e` of hex `(r, c)` is the same physical boundary as edge `(e + 3) % 6` of its neighbour in direction `e`. Properties can be set from either side; `getEdge` merges both records (own record takes precedence on key conflicts).

```js
layer.setEdge(row, col, edge, props)  // merge props into this hex's edge record
layer.getEdge(row, col, edge)         // → merged record (own + neighbour), or null
layer.getEdgeOwn(row, col, edge)      // → only this hex's record, no neighbour merge
layer.clearEdge(row, col, edge)       // delete this hex's edge record
layer.hasEdge(row, col, edge)         // → bool; true if either side has a record
layer.forEachEdge(fn)                 // fn(row, col, edge, props) for every stored edge record
```

Edge indices 0–5 follow cube-direction order (E, NE, NW, W, SW, SE for pointy-top).

#### Serialisation

```js
layer.toJSON()                          // → { hexes: [...], edges: [...] }
layer.fromJSON(data)                    // merge into existing data
layer.fromJSON(data, { replace: true }) // clear first, then load
```

#### drawHexFn

Called for each visible hex that has a stored property record (or every visible hex in complete mode with `drawUnset: true`). The context is already in world space.

```js
drawHexFn(ctx, hex, props, hexMap)
// hex      — { row, col, q, r, cx, cy }
// props    — the hex's property object (null in complete+drawUnset mode)
// hexMap   — HexMap instance
```

#### drawEdgeFn

Called for each visible edge that has at least one property record. Each edge is drawn at most once per frame (shared edges are deduplicated via a per-frame Set). Pre-computed geometry is passed so no trig is needed inside the function.

```js
drawEdgeFn(ctx, edgeGeom, props, hexMap)
// edgeGeom — { row, col, edge, cx, cy, x0, y0, x1, y1, mx, my, nx, ny, nbrRow, nbrCol }
//   cx, cy     — world-space centre of the canonical hex
//   x0/y0, x1/y1 — world-space endpoints of the edge
//   mx, my     — edge midpoint
//   nx, ny     — outward unit normal (points away from hex centre)
//   nbrRow/nbrCol — neighbour coordinates; -1 if off-grid
// props    — merged edge record (own + neighbour, own takes precedence)
```

**Line width guidance.** Use world-space line widths (no division by zoom) so features scale proportionally with the hex at all zoom levels — matching the behaviour of hex decorations. Apply a minimum floor to keep lines visible at extreme zoom-out or on the minimap:

```js
function drawEdgeFn(ctx, geom, props, hexMap) {
    const zoom = hexMap._viewport.zoom;
    ctx.lineWidth = Math.max(props.width, 0.5 / zoom);  // world-space + 0.5px floor
    // ...
}
```

---

### DomLayer

Base class for layers that live in the DOM overlay rather than the canvas. The overlay is a `pointer-events:none` div that covers the canvas exactly and is unaffected by pan/zoom/rotation.

```js
class MyOverlay extends HexViewer.DomLayer {
  constructor() {
    super('my-overlay');
    // this.element is a position:absolute div spanning the full canvas area.
    // Add your own child elements to it.
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;top:10px;left:10px;pointer-events:auto;';
    div.textContent   = 'Hello';
    this.element.appendChild(div);
  }
}
map.addLayer(new MyOverlay());
```

`get element` returns the full-size container div. Set `pointer-events:auto` on individual child elements to make them interactive; the container itself stays passthrough.

### PanelLayer

A pre-styled, positioned panel for game information. Extends `DomLayer`.

```js
new HexViewer.PanelLayer(name, options)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `visible` | boolean | `true` | Initial visibility |
| `position` | object | — | `{ top, right, bottom, left }` — CSS lengths or numbers (px) |
| `html` | string | — | Initial inner HTML |

```js
const panel = new HexViewer.PanelLayer('status', {
  position: { top: 10, right: 10 },
  html: '<b>Hex info</b>',
});
panel.setSize({ width: 180 });
map.addLayer(panel);

// Update content at any time — no map.refresh() needed
panel.html = `Row ${row}, Col ${col}`;

// Direct DOM access for arbitrary manipulation
panel.panelElement.style.background = 'rgba(40,0,0,0.9)';
panel.panelElement.appendChild(someButtonElement);
```

```js
panel.setPosition({ top, right, bottom, left })   // reposition
panel.setSize({ width, height })                   // resize
panel.html = '<p>content</p>'                      // set innerHTML
panel.panelElement                                 // the <div> element
```

`setLayerVisible('panel-name', bool)` and the `visible` property both update the panel's `display` style immediately — no canvas redraw is triggered.

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

#### Rendering map content

By default the minimap shows a flat background. Call `redraw` to render one or more layers into an off-screen canvas that is then composited as the minimap background each frame:

```js
const minimap = new HexViewer.MinimapLayer({ width: 280, height: 200 });
map.addLayer(minimap);

// After map data is populated:
minimap.redraw(map, [terrainLayer, edgesLayer]);
```

The off-screen canvas is static — call `redraw` again whenever the underlying data changes. Each layer is rendered at full-map scale (all hexes, no viewport culling) with line widths automatically adjusted for the minimap scale.

---

## Image layer (`src/image-layer.js`)

Load after `hexviewer.js`. Exposes `window.HexViewer.ImageLayer`.

```html
<script src="src/hexviewer.js"></script>
<script src="src/image-layer.js"></script>
```

Places a PNG (or any canvas-drawable image) in world space so it pans, zooms, and rotates with the hex grid. Three modes are supported.

```js
new HexViewer.ImageLayer(name, image, options)
```

`image` may be an `HTMLImageElement`, `HTMLCanvasElement`, `ImageBitmap`, or a URL string. URL strings load asynchronously and trigger a refresh when ready.

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | string | `'fill'` | `'fill'`, `'anchor'`, or `'tile'` |
| `alpha` | number | `1` | Opacity 0–1; adjustable at runtime |
| `visible` | boolean | `true` | Initial visibility |

Shared anchor/fill option:

| Option | Type | Default | Description |
|---|---|---|---|
| `x`, `y` | number | `0, 0` | World-space top-left of the image |
| `row`, `col` | number | — | Hex to centre the image on (overrides `x`/`y`) |
| `width`, `height` | number | image px × `scale` | Image extent in world units |
| `scale` | number | `1` | Pixels-to-world-units multiplier |

Tile-only options:

| Option | Type | Default | Description |
|---|---|---|---|
| `tileWidth` | number | image width px | World-unit width of one tile |
| `tileHeight` | number | image height px | World-unit height of one tile |
| `originX`, `originY` | number | `0, 0` | World-space tiling origin |

### Modes

**`'fill'`** — stretches the image to cover the full hex grid extent. The bounding box is computed from the actual hex corner positions and cached.

```js
// Map scan stretched to fill the whole grid
const mapImg = new HexViewer.ImageLayer('map', 'map.png', {
  mode: 'fill', alpha: 0.85,
});
map.addLayer(mapImg, 0);   // insert below hex outlines
```

**`'anchor'`** — places the image at fixed world coordinates or centred on a specific hex.

```js
// Icon centred on hex (5, 10), 60×60 world units
const icon = new HexViewer.ImageLayer('icon', iconImg, {
  mode: 'anchor', row: 5, col: 10, width: 60, height: 60,
});

// Image at explicit world position
const marker = new HexViewer.ImageLayer('marker', markerImg, {
  mode: 'anchor', x: 200, y: 150, width: 80, height: 80, alpha: 0.9,
});
```

**`'tile'`** — repeats the image across the visible area. Only tiles that intersect the viewport are drawn, making this efficient even for large grids.

```js
// Parchment texture tiled at 80×80 world units (2× hexSize)
const bg = new HexViewer.ImageLayer('bg', 'parchment.png', {
  mode: 'tile', tileWidth: 80, tileHeight: 80, alpha: 0.7,
});
map.addLayer(bg, 0);
```

### Performance

All three modes clip to the visible viewport before drawing:

- **fill / anchor** — use the 9-argument `drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh)` form so only the visible crop of the source image is submitted to the GPU each frame.
- **tile** — computes the tile-index range that overlaps the visible AABB and draws only those tiles; off-screen tiles are never touched.

The map bounding box (used by fill mode) is computed once on first render and cached until the layer is re-attached.

**Per-frame cost is O(visible pixels)**, not O(image size). A 4096×4096 fill image and a 512×512 fill image cost the same to render at a given zoom level, because only the on-screen crop is ever transferred to the GPU.

**GPU texture size limit.** Browsers upload the whole image to the GPU as a texture when it is first drawn. Most devices support up to 4096×4096 or 8192×8192 pixels; images larger than this may be silently downscaled by the browser. Practical guidance:

| Image size | Notes |
|---|---|
| ≤ 2048×2048 | Safe on all hardware including mobile |
| 4096×4096 | Safe on desktop and modern mobile |
| 8192×8192 | Works on most desktop GPUs; may fail on low-end mobile |
| > 8192×8192 | Risky — browser may silently downscale or refuse |

For a scanned board game map used as a fill image, **2048×2048 or 4096×4096 is recommended**.

**No quadtree needed.** The `tile` mode already handles repeating patterns efficiently by drawing only the visible tiles each frame. A quadtree/LOD system (like Leaflet's tile pyramid) is only warranted when you need to stream many different image chunks at multiple zoom levels from a server — that is a different use case. For a single background image or a simple repeating texture, `fill` or `tile` mode gives acceptable performance without extra complexity.

### Runtime control

```js
layer.alpha   = 0.5;   // change opacity
layer.visible = false; // hide (same as map.setLayerVisible)
map.refresh();         // force redraw after property change
```

### Generated images (no file needed)

A canvas element can be passed directly, which is useful for procedurally generated backgrounds:

```js
function makeParchmentTile(size) {
  const el = document.createElement('canvas');
  el.width = el.height = size;
  const c = el.getContext('2d');
  c.fillStyle = '#ddd3a8';
  c.fillRect(0, 0, size, size);
  c.strokeStyle = 'rgba(120,95,45,0.2)';
  c.strokeRect(0.5, 0.5, size - 1, size - 1);
  return el;
}

const bg = new HexViewer.ImageLayer('bg', makeParchmentTile(128), {
  mode: 'tile', tileWidth: 80, tileHeight: 80, alpha: 0.7,
});
map.addLayer(bg, 0);
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
| `largeScale` | number | `1.15` | Large counter side as a multiple of `hexSize` |
| `smallScale` | number | `0.85` | Small counter side as a multiple of `hexSize` |
| `onSelectionChange` | function | `null` | Called with a `Set` of selected ids on every selection change |
| `onContextMenu` | function | `null` | Called on right-click over a counter — see [Context menu](#context-menu) |

```js
layer.addCounter(counter)        // add a Counter instance
layer.removeCounter(id)          // remove by id; fires onSelectionChange if it was selected
layer.getCounter(id)             // returns Counter or null
layer.getSelected()              // returns snapshot Set of selected ids
layer.setSelection(ids)          // replace selection with array/iterable of ids
layer.clearSelection()           // deselect all
layer.closeWarp()                // collapse warp-out view
```

**Stacking:** counters on the same hex are drawn as a stack — large counters below small counters, with a pixel offset to show depth. A badge shows the stack count when more than one counter is present.

**Warp-out:** double-clicking a stack with more than one counter spreads them horizontally above the hex with dashed leader lines. While warp is open, all other hex stacks are shown at reduced opacity. The leader line colour automatically contrasts against the map background. Click outside the warp area to collapse it.

**Selection:**
- **Click** a stack — selects every counter in it, deselects everything else.
- **Shift-click** a stack — toggles the whole stack (adds all if any are unselected; removes all if all are already selected).
- **Click** a warped counter — selects only that counter, clears others.
- **Shift-click** a warped counter — toggles just that counter.
- The yellow selection border persists across warp open/close.

**3D depth effect:** shadow, highlight bevel, and shadow bevel strips are automatically suppressed when the counter would render smaller than ~14 CSS pixels wide.

### Selection change callback

`onSelectionChange(ids)` fires after every selection mutation. `ids` is a snapshot `Set` of the currently selected counter ids.

```js
layer.onSelectionChange = (ids) => {
  if (ids.size === 0) {
    panel.visible = false;
    return;
  }
  const counters = [...ids].map(id => layer.getCounter(id));
  panel.html = counters.map(c =>
    `<div>${c.id} — ${c.size} at hex ${map.getHexLabel(c.row, c.col)}</div>`
  ).join('');
  panel.visible = true;
};
```

### Context menu

`onContextMenu(counter, stack, clientX, clientY)` fires when the user right-clicks a counter. `counter` is the specific counter clicked; `stack` is the full array of counters on that hex; `clientX`/`clientY` are viewport coordinates for positioning the menu.

```js
layer.onContextMenu = (counter, stack, x, y) => {
  showMenu([
    { label: `Select stack (${stack.length})`,
      action: () => layer.setSelection(stack.map(c => c.id)) },
    { label: 'Deselect all',
      action: () => layer.clearSelection() },
    { label: `Move ${counter.id}…`,
      action: () => openMoveDialog(counter) },
    { label: `Delete ${counter.id}`,
      action: () => layer.removeCounter(counter.id) },
  ], x, y);
};
```

**Minimal DOM implementation** (used in the demos):

```html
<!-- Add to <style> -->
<style>
#ctx-menu {
  display: none; position: fixed; z-index: 1000;
  background: rgba(10,20,30,0.96); border: 1px solid #4a6a88;
  border-radius: 4px; padding: 4px 0; min-width: 180px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.55);
}
.ctx-item { padding: 5px 14px; cursor: pointer; font-size: 13px; }
.ctx-item:hover { background: #1a3a58; }
.ctx-sep  { height: 1px; background: #2d4050; margin: 4px 0; }
</style>

<!-- Add to <body> -->
<div id="ctx-menu"></div>
```

```js
const ctxMenu = document.getElementById('ctx-menu');
let ctxCounter = null, ctxStack = null;

layer.onContextMenu = (counter, stack, x, y) => {
  ctxCounter = counter;
  ctxStack   = stack;

  ctxMenu.innerHTML =
    `<div class="ctx-item" data-action="select">Select stack (${stack.length})</div>` +
    `<div class="ctx-sep"></div>` +
    `<div class="ctx-item" data-action="delete">Delete ${counter.id}</div>`;

  // Keep menu inside the viewport
  ctxMenu.style.left    = Math.min(x, innerWidth  - 190) + 'px';
  ctxMenu.style.top     = Math.min(y, innerHeight - 100) + 'px';
  ctxMenu.style.display = 'block';
};

ctxMenu.addEventListener('click', e => {
  const item = e.target.closest('[data-action]');
  if (!item) return;
  ctxMenu.style.display = 'none';
  if (item.dataset.action === 'select')
    layer.setSelection(ctxStack.map(c => c.id));
  else if (item.dataset.action === 'delete')
    layer.removeCounter(ctxCounter.id);
});

// Dismiss on outside click or Escape
document.addEventListener('click',   e => { if (!ctxMenu.contains(e.target)) ctxMenu.style.display = 'none'; }, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') ctxMenu.style.display = 'none'; });
```

---

## Map details layer (`src/map-details-layer.js`)

Load after `hexviewer.js`. Exposes `window.HexViewer.MapDetailsLayer`.

```html
<script src="src/hexviewer.js"></script>
<script src="src/map-details-layer.js"></script>
```

Draws connectors (lines between hex centres) and border segments (highlighted hex edges) in world space.

```js
const details = new HexViewer.MapDetailsLayer('map-details');
map.addLayer(details);
```

All methods return `this` for chaining. Calling any add method triggers a single redraw.

### Connectors

A connector is a straight line between two hex centres, optionally inset from each end.

```js
details.addConnector({ from, to, fromOffset, toOffset, width, color, alpha, dash })
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `from` | `{row, col}` | required | Source hex |
| `to` | `{row, col}` | required | Target hex |
| `fromOffset` | number | `0` | Pull line back this many world units from the source centre |
| `toOffset` | number | `0` | Pull line back this many world units from the target centre |
| `width` | number | `2` | Stroke width in world units |
| `color` | string | `'#ffffff'` | Stroke colour |
| `alpha` | number | `1.0` | Opacity 0–1 |
| `dash` | number[] | `[]` | `setLineDash` pattern; `[]` = solid |

```js
// Solid connector between two hexes
details.addConnector({ from: { row: 2, col: 3 }, to: { row: 5, col: 8 },
                       color: '#ffaa00', width: 3 });

// Dashed connector pulled back 10 units from each hex centre
details.addConnector({ from: { row: 0, col: 0 }, to: { row: 10, col: 10 },
                       fromOffset: 10, toOffset: 10,
                       color: '#4488ff', dash: [8, 4] });
```

### Borders

A border highlights a single edge of a hex. The edge is identified by its index (0–5), where the edges are numbered clockwise starting from corner 0. Endpoints are drawn with rounded line caps.

```js
details.addBorder({ row, col, edge, width, color, alpha, dash })
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `row` | number | required | Hex row |
| `col` | number | required | Hex column |
| `edge` | number | required | Edge index 0–5, clockwise from corner 0 |
| `width` | number | `2` | Stroke width in world units |
| `color` | string | `'#ffffff'` | Stroke colour |
| `alpha` | number | `1.0` | Opacity 0–1 |
| `dash` | number[] | `[]` | `setLineDash` pattern; `[]` = solid |

```js
// Highlight edge 0 of hex (3, 5) in red
details.addBorder({ row: 3, col: 5, edge: 0, color: '#ff4444', width: 4 });
```

#### Batch borders

```js
details.addBorderSegments(segments, sharedStyle)
```

`segments` is an array of `{ row, col, edge }` objects. `sharedStyle` applies the same `width`, `color`, `alpha`, and `dash` to all of them. A single redraw is triggered after all segments are added.

```js
details.addBorderSegments(
  [{ row: 1, col: 1, edge: 0 }, { row: 1, col: 1, edge: 1 }, { row: 2, col: 3, edge: 4 }],
  { color: '#ff0000', width: 3 }
);
```

### Clearing

```js
details.clearAll()   // remove all connectors and borders, trigger redraw
```

---

## Hex pathfinder (`src/hex-pathfinder.js`)

Load after `hexviewer.js`. Exposes `window.HexViewer.findPath`.

```html
<script src="src/hexviewer.js"></script>
<script src="src/hex-pathfinder.js"></script>
```

Finds the shortest path between two hex corners (vertices) travelling strictly along hex edges. Uses A* with a Euclidean heuristic, so among equal-length paths it prefers the geometrically straighter one.

```js
HexViewer.findPath(fromSpec, toSpec, hexMap)
```

| Parameter | Type | Description |
|---|---|---|
| `fromSpec` | `{row, col, vertex}` | Start corner — vertex 0–5 |
| `toSpec`   | `{row, col, vertex}` | End corner — vertex 0–5 |
| `hexMap`   | `HexMap` | The map whose layout and grid bounds to use |

Returns an array of `{row, col, edge}` objects suitable for `addBorderSegments`, `[]` if start equals end, or `null` if no path exists (unreachable).

```js
const segs = HexViewer.findPath(
  { row: 0, col: 0, vertex: 4 },   // top corner of hex 0,0
  { row: 5, col: 8, vertex: 1 },   // bottom corner of hex 5,8
  map,
);

if (segs) detailsLayer.addBorderSegments(segs, { color: '#ff8800', width: 3 });
```

### Algorithm

The vertex graph has one node per hex corner (geometric point), with three edges at each interior vertex (one per adjacent hex edge). Each edge has cost 1 (all hex edges are the same length), so the shortest path minimises edge count. A* with the Euclidean heuristic guides expansion toward the goal and naturally selects the most direct route among ties.

Node identity uses a rounded world-position key (`Math.round(x * 100), Math.round(y * 100)`) to handle the fact that each geometric vertex is shared by up to three hexes and would otherwise appear as multiple `{row, col, vertex}` specs.

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

### Visible-hex culling

`_computeVisibleHexes` uses the viewport AABB to estimate the candidate row/col range before iterating, so only hexes near the visible area are checked. The inner loop is fully inlined — no function calls and no temporary object allocations. Per-row constants (y position, stagger offset) are hoisted out of the column loop, and entire rows outside the AABB are skipped with a single compare. Frame cost is O(visible hexes), not O(grid size), making large grids (e.g. 1000×1000) interactive.

### Outline rendering

`HexOutlineLayer` reads corner offsets directly from the precomputed `cornerOffsets` array rather than calling `Geometry.hexCorners`, avoiding one array and six point-object allocations per hex per frame. For 20,000 visible hexes this eliminates ~140,000 short-lived allocations per frame.

The `minScreenSize` threshold (default 8 px) stops outline drawing when hexes are too small to show useful detail. Borders become the dominant draw-call cost at large hex counts; hiding them below ~8 px radius (roughly 120+ columns visible on a 1920 px screen) keeps panning smooth.

### General guidance

| Visible hexes | Typical behaviour |
|---|---|
| < 5,000 | Smooth at 60 fps with all layers enabled |
| 5,000–20,000 | Smooth with outlines; enable `minScreenSize` ≥ 8 to stay smooth |
| > 20,000 | Raise `minScreenSize` or disable outlines entirely |

`demo-perf.html` provides a 1000×1000 grid with 24,000 randomly placed counters (plus several explicit large stacks for warp testing), a minimap, overlay panels, context menu, FPS counter, and an outline `minScreenSize` slider for benchmarking.
