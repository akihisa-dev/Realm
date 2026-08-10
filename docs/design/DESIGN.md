# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- [Startup concept](concepts/initial-startup.png): no world is open; the app-managed library, create action, and transfer-data import are available.
- A world-open editor provides the three terrain tools (move, draw, and erase) plus `戻す` and `進む`. Valid terrain edits save automatically.

The startup concept defines composition and density. Visible controls remain code-native. The primary rail exposes exactly three tools: move, draw terrain, and erase terrain. There is no terrain list, creation form, drawing-settings panel, or presentation-settings sidebar. Terrain is drawn with the editor's fixed freehand profile and edited directly on the canvas. Non-terrain compatibility rows never appear in the editor.

## Visual system

- Interface chrome uses true white and cool neutral gray. Cartographic themes may color the map canvas, but must not turn toolbars and panels into decorative scenery.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses one native overlay title bar with only `戻す` and `進む`, a narrow three-item primary rail, and a dominant OpenLayers canvas. The rail continues to the bottom edge; no secondary sidebar, floating map buttons, or bottom zoom bar is shown. Do not draw a second set of macOS traffic lights in React. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

## Allowed initial copy

The startup state uses `Realm`, `創作世界の地図を、アプリ内で安全に管理。`, `新しい世界を作成`, and `移行データを読み込む`, together with the library worlds. The open editor uses only `戻す`, `進む`, `移動`, `地形を描く`, and `地形を消す`. File actions, export controls, world-name editing, zoom buttons, terrain lists, creation metadata, drawing configuration, presentation settings, unavailable layers, and asset management are not shown.

## Renderer boundary

React owns transient interface state, including the terrain tool, viewport, and terrain selection. OpenLayers objects and theme definitions live behind the map adapter and render terrain from a snapshot only; they never become storage. The selected theme identifier, grid visibility, export scale, and export extent are bounded project settings that survive reopening. Per-terrain opacity, lock, visibility, and order are plain validated properties in the `.realmmap`, never renderer objects or external paths.

Only `terrain` polygons are passed from the editor to the renderer. Their overlap order is derived from bounded terrain properties and never changes stored geometry. Older non-terrain rows remain storage compatibility data and are not rendered by the editor.

## App icon assets

`app/src-tauri/icons/icon.png` is the transparent master for the bundled app icon. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master with the Tauri icon command. `pnpm icon:check` verifies transparent corners and opaque subject pixels in both the PNG files and the PNG representations embedded in the ICNS container.
