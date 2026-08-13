# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- Realm enters the editor directly with the 64 by 37 regular-hexagon editing grid fitted inside the available canvas at relative zoom 1. The complete bounded world remains visible with fit padding equal to 10% of the shorter viewport side, clamped from 40 through 160 CSS pixels on every side, and without deforming boundary cells. A narrow or wide viewport may leave additional letterbox space on its secondary axis, but cannot zoom out beyond that full-world view. Resizing recomputes the fit and responsive padding while preserving the relative zoom. The editor does not render separate origin or focus axes. It restores the open world when one exists, otherwise opens the first world in the app-managed library, or creates `無題の世界` when the library is empty.
- The editor provides terrain drawing/thickness, region coloring, and erasing in the map tool palette, plus `戻す` and `進む`. Valid terrain and region edits save automatically; natural map pan gestures remain available.

Visible controls remain code-native. The radial map palette exposes the terrain drawing/thickness control, region color control, and eraser. There is no startup screen, terrain list, creation form, persistent drawing-range panel, or presentation-settings sidebar. Selecting `地形を描く（太さ調整）` activates terrain drawing and opens an accessible 1–5 cell thickness flyout. Selecting `領域` activates bounded polygon drawing and opens an accessible native color input; the chosen color remains transient until a completed polygon is saved. Selecting `消しゴム` activates terrain erasing and opens only its 1–5 cell thickness control. The flyouts remain outside the palette, clamp to the viewport, and close on the documented exclusive, outside, Escape, or blur actions. Terrain drawing and erasing retain their temporary previews and cancellation guarantees. A primary-button map action used to dismiss the palette is consumed and cannot also edit or pan the map. Only region feature rows appear over the terrain; other feature rows and non-terrain compatibility cells remain hidden.

## Visual system

- Interface chrome uses true white and cool neutral gray. The default map canvas is true white; persistent terrain is shown by an unfilled outline rather than a colored interior. Optional cartographic themes may color the canvas, but must not turn toolbars and panels into decorative scenery.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible. Terrain outline changes use a brief, non-looping grid-aligned expansion or retraction, and new regions briefly fade into their final style, while `prefers-reduced-motion` applies completed presentation immediately.

## Layout contract

The editor uses one native overlay title bar with only `戻す` and `進む`, a dominant OpenLayers canvas, and a contextual map palette. No primary rail, secondary sidebar, floating map buttons, or bottom zoom bar is shown. Do not draw a second set of macOS traffic lights in React. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

The move tool pans the viewpoint with a primary-button drag. A middle-button drag pans in every tool without changing the active tool, and Space plus a primary-button drag provides the same temporary navigation path. Viewpoint movement remains constrained to the fixed editing world so the grid cannot be dragged aside to expose empty canvas. Wheel rotation zooms the canvas.

The canvas cursor reflects the active operation: `grab` for move/navigation, a crosshair for terrain or region drawing, and a small eraser cursor for terrain removal. An explicitly disabled canvas uses `not-allowed`; OpenLayers' `grab`/`grabbing` feedback remains the highest-priority state while a pan drag is active.

## Allowed editor copy

The editor uses only `戻す` and `進む` in the top row; `地形を描く（太さ調整）`, `領域`, and `消しゴム` with their transient settings are available from the map palette. Startup, library, import, file actions, export controls, world-name editing, zoom buttons, terrain lists, creation metadata, persistent drawing configuration, presentation settings, unavailable layers, and asset management are not shown. There is no separate move button; natural map pan gestures remain available.

## Renderer boundary

React owns transient interface state, including the active tool, region color, viewport, draw-paint range, and current paint selection. OpenLayers objects, derived hex polygons, and theme definitions live behind the map adapter and never become storage. The selected theme identifier, grid visibility, export scale, and export extent are bounded project settings that survive reopening.

Only `terrain` cell attributes are passed to the semantic cell renderer. A separate bounded renderer draws the complete fixed editing grid without creating persistent cell geometry. Persisted terrain has no fill: shared edges are removed and the remaining exposed edges form each terrain mass outline. Region polygons are passed separately as visible features with validated color properties; other compatibility features remain hidden. Changed terrain outlines interpolate along the grid, while newly saved regions briefly fade into their final translucent fill and outline. Both transitions are renderer-only, never enter saved data or undo history, and resolve immediately when reduced motion is requested. World-edge terrain cells and region polygons remain within the bounded world, and the map view fits that extent with responsive padding.

## App icon assets

The transparent PNG master is the source for the bundled app icon used by Electron Forge. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master; package inspection verifies the bundled icon and metadata without launching the app.
