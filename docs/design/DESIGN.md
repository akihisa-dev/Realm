# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- Realm enters the editor directly with the 64 by 37 regular-hexagon editing grid covering the canvas vertically at relative zoom 1. On a viewport wider than the bounded 2:1 world, only the horizontal world edges are clipped; the grid never gains letterbox gaps above or below. This is also the widest allowed view; the editor does not render separate origin or focus axes. It restores the open world when one exists, otherwise opens the first world in the app-managed library, or creates `無題の世界` when the library is empty.
- The editor provides the three terrain tools (move, draw, and erase) plus `戻す` and `進む`. Valid terrain edits save automatically.

Visible controls remain code-native. The primary rail exposes exactly three tools: move, draw terrain, and erase terrain. There is no startup screen, terrain list, creation form, persistent brush-settings panel, or presentation-settings sidebar. Hovering or focusing the draw tool opens a short popout with an accessible 1–5 cell brush-thickness range; the pointer may move from the tool into the popout without closing it. Drawing uses that transient thickness; erasing always uses one cell (hex distance 0), regardless of the selected draw thickness. While the pointer is over the map, the cells the draw brush would affect are shown as a temporary dashed preview, and adjacent cell edges define the map boundary. A stroke canceled by pointer exit, external release, lost capture, window blur, Space navigation, or Escape cannot remain in a dragging state or commit its transient selection. The temporary radial palette opened from the map closes on Escape, window blur, or any pointer action outside the palette. A primary-button map action used to dismiss the palette is consumed and cannot also paint, erase, or pan the map. Feature rows and non-terrain compatibility cells never appear in the editor.

## Visual system

- Interface chrome uses true white and cool neutral gray. The default unpainted map canvas is true white; persistent terrain cells provide the map color. Optional cartographic themes may color the canvas, but must not turn toolbars and panels into decorative scenery.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses one native overlay title bar with only `戻す` and `進む`, a narrow three-item primary rail, and a dominant OpenLayers canvas. The rail continues to the bottom edge; no secondary sidebar, floating map buttons, or bottom zoom bar is shown. Do not draw a second set of macOS traffic lights in React. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

The move tool pans the viewpoint with a primary-button drag. A middle-button drag pans in every tool without changing the active tool, and Space plus a primary-button drag provides the same temporary navigation path. Viewpoint movement remains constrained to the fixed editing world so the grid cannot be dragged aside to expose empty canvas. Wheel rotation zooms the canvas.

## Allowed editor copy

The editor uses only `戻す`, `進む`, `移動`, `地形を描く`, and `地形を消す` as named commands. The draw tool's transient `筆の太さ` popout is the only drawing configuration surface. Startup, library, import, file actions, export controls, world-name editing, zoom buttons, terrain lists, creation metadata, persistent drawing configuration, presentation settings, unavailable layers, and asset management are not shown.

## Renderer boundary

React owns transient interface state, including the terrain tool, viewport, draw-brush thickness, and current brush selection. OpenLayers objects, derived hex polygons, and theme definitions live behind the map adapter and never become storage. The selected theme identifier, grid visibility, export scale, and export extent are bounded project settings that survive reopening.

Only `terrain` cell attributes are passed from the editor to the semantic cell renderer. A separate bounded renderer draws the complete fixed editing grid without creating persistent or selectable cell objects. The semantic renderer derives a tessellating polygon only for terrain and transient brush cells and fills it with the terrain theme; clearing terrain removes that semantic polygon so no outline trail remains. World-edge cells and the editing grid are clipped to the canvas boundary. Feature rows and older non-terrain cell rows remain storage compatibility data and are not rendered by the editor.

## App icon assets

`app/src-tauri/icons/icon.png` is the transparent master for the bundled app icon. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master with the Tauri icon command. `pnpm icon:check` verifies transparent corners and opaque subject pixels in both the PNG files and the PNG representations embedded in the ICNS container.
