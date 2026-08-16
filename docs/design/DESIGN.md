# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles are derived renderers over the same three-layer project data.

## Initial states

- Realm enters the editor directly with the fixed 128 by 73 hexagonal editing grid filling a centered 4:3 canvas frame at relative zoom 1. It restores the open world when one exists, otherwise opens the first library world, or creates `無題の世界` when the library is empty.
- The right panel is the layer manager. Its `地形`, `領域`, and `オブジェクト` tabs select the active editing layer. The selected layer alone receives primary-pointer edits; all three layers remain visible.
- The left sidebar is generated from the active layer. Terrain shows terrain draw, terrain eraser, grab, and shaping. Region shows region draw, region eraser, grab, and shaping. Object shows object placement, object kind selection, object selection/movement, and object eraser.
- “Draw” and “eraser” are shared interaction patterns, not shared semantics. Terrain uses hex-cell painting, region uses freehand enclosure selection, and objects use kind-specific point or polygon placement. Their handlers, previews, and storage results are separate.
- Preview is renderer-only and read-only. It disables layer changes and editing controls while retaining map pan and zoom. Escape, pointercancel, blur, lost capture, and layer switching cancel incomplete gestures.

## Visual system

- Interface chrome uses true white and cool neutral gray. The default map canvas is true white; persistent terrain is shown by an unfilled outline rather than a decorative terrain fill.
- Text is charcoal with a restrained deep blue-green selection accent. Use the macOS system font stack and compact explicit control typography.
- Prefer rails, separators, tabs, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas. Keyboard focus remains visible.
- Terrain and region transitions, object placement feedback, and preview smoothing are renderer-only effects. They never change saved data or undo history, and reduced motion resolves them immediately.

## Layout contract

The editor uses one native overlay title bar with the shared `太さ` range on the left and icon-only preview, history, and layer-panel controls on the right. The dominant OpenLayers canvas sits between the collapsible left tool sidebar and the right layer manager. No separate primary rail, bottom zoom bar, or second set of macOS traffic lights is shown.

The selected layer is visible in both the right tab and the left tool labels. The right panel may close, but closing it does not change `activeLayer`; reopening shows the same layer. The tab panel is disabled during preview and while a mutation is being committed.

The map moves with a primary-button drag in pan/selection mode. A middle- or right-button drag pans in every tool without changing the active layer, and Space plus a primary-button drag provides the same temporary navigation path. The right-button context menu is suppressed on the map. Wheel rotation zooms the canvas. Viewpoint movement remains constrained to the fixed editing world.

The cursor reflects the active operation: crosshair for terrain or region drawing, object placement cursor for object kinds, grab for navigation and shape movement, and a layer-specific eraser cursor for deletion. OpenLayers' `grab`/`grabbing` feedback remains the highest-priority state while a pan drag is active.

## Allowed editor copy

The left sidebar uses layer-specific names: `地形を描く`, `領域を描く`, `オブジェクトを配置`, `地形消しゴム`, `領域消しゴム`, and `オブジェクト消しゴム`. The region color choices, object kind choices, and eraser status remain accessible when the rail is collapsed through flyouts. The header range is shared by terrain and region cell painting/erasing; object placement does not use it.

The right panel uses `レイヤー管理` as its accessible name. Its terrain tab reports current terrain shapes, its region tab lists logical regions and disconnected parts, and its object tab provides kind selection, label input, placement, selection, movement, and deletion. A region is always described as a region, never as an object.

## Renderer boundary

React owns transient interface state: active layer, active operation, object draft, region color, viewport, shared drawing range, cell selection, selected objects/regions, layer-panel state, and preview state. OpenLayers objects, derived hex polygons, and theme definitions live behind the map adapter and never become storage.

The renderer registry keeps separate sources and layers for terrain, region, and object. Their draw order is:

```text
terrain → region → object
```

Terrain and region editing uses exact saved grid-snapped Polygon geometry. The preview may derive smoothed outlines, but it never replaces the canonical geometry. Object styles are chosen by kind and read `label`, `properties`, `locked`, `asset_id`, and `z_index`. Object overlap is intentional. Cell polygons and cell IDs support transient paint, erase, and hit testing only.

The active-layer gate is enforced in the adapter as well as in React. Selection, primary-pointer drawing, movement, and erasing are filtered to the active layer. A layer switch clears the adapter's pointer interactions and controlled selection before installing the next layer's mode. Pan and zoom remain shared across the gate.

## App icon assets

The transparent PNG master is the source for the bundled app icon used by Electron Forge. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. Other PNG sizes and `icon.icns` are generated from that master; package inspection verifies the bundled icon and metadata without launching the app.
