# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- Realm enters the editor directly. It restores the open world when one exists, otherwise opens the first world in the app-managed library, or creates `無題の世界` when the library is empty.
- The editor provides the three terrain tools (move, draw, and erase) plus `戻す` and `進む`. Valid terrain edits save automatically.

Visible controls remain code-native. The primary rail exposes exactly three tools: move, draw terrain, and erase terrain. There is no startup screen, terrain list, creation form, brush-settings panel, or presentation-settings sidebar. Drawing and erasing use one fixed hex-cell brush, and adjacent cell edges define the map boundary. Feature rows and non-terrain compatibility cells never appear in the editor.

## Visual system

- Interface chrome uses true white and cool neutral gray. Cartographic themes may color the map canvas, but must not turn toolbars and panels into decorative scenery.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses one native overlay title bar with only `戻す` and `進む`, a narrow three-item primary rail, and a dominant OpenLayers canvas. The rail continues to the bottom edge; no secondary sidebar, floating map buttons, or bottom zoom bar is shown. Do not draw a second set of macOS traffic lights in React. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

## Allowed editor copy

The editor uses only `戻す`, `進む`, `移動`, `地形を描く`, and `地形を消す`. Startup, library, import, file actions, export controls, world-name editing, zoom buttons, terrain lists, creation metadata, drawing configuration, presentation settings, unavailable layers, and asset management are not shown.

## Renderer boundary

React owns transient interface state, including the terrain tool, viewport, and current brush selection. OpenLayers objects, derived hex polygons, and theme definitions live behind the map adapter and never become storage. The selected theme identifier, grid visibility, export scale, and export extent are bounded project settings that survive reopening.

Only `terrain` cell attributes are passed from the editor to the cell renderer. The renderer derives a tessellating polygon for each stable cell identifier and fills it with the terrain theme; world-edge cells are clipped to the canvas boundary. Feature rows and older non-terrain cell rows remain storage compatibility data and are not rendered by the editor.

## App icon assets

`app/src-tauri/icons/icon.png` is the transparent master for the bundled app icon. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master with the Tauri icon command. `pnpm icon:check` verifies transparent corners and opaque subject pixels in both the PNG files and the PNG representations embedded in the ICNS container.
