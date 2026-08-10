# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- [Startup concept](concepts/initial-startup.png): no world is open; the app-managed library, create action, and transfer-data import are available.
- A world-open editor provides pan, zoom, feature drawing and selection, cell-brush painting, undo, redo, library return, PNG/JPEG/PDF export, and transfer export. Valid edits save automatically.

The startup concept defines composition and density. Visible controls remain code-native. The primary rail exposes the manual feature classes together with selection, erase, and cell-brush tools. The sidebar lists features, configures forest, country, and region brush attributes, paint/erase mode and size, edits the selected feature's supported appearance and order values, and manages project-embedded symbol assets.

## Visual system

- Interface chrome uses true white and cool neutral gray. Cartographic themes may color the map canvas, but must not turn toolbars and panels into decorative scenery.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses one native overlay title bar with a compact file toolbar, a narrow primary rail, a project sidebar, a dominant OpenLayers canvas, and compact map controls. The rail and sidebar continue to the bottom edge. Do not draw a second set of macOS traffic lights in React. At smaller widths the project sidebar may collapse, but the map remains usable. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

## Allowed initial copy

The startup state uses `Realm`, `創作世界の地図を、アプリ内で安全に管理。`, `新しい世界を作成`, and `移行データを読み込む`, together with the library worlds. The editor uses the world name, `ライブラリ`, `PNG`, `PDF`, `移行データ`, `自動保存中…`, `自動保存済み`, `元に戻す`, `やり直す`, `世界`, feature class names, the feature count, and the zoom value. Controls for unavailable layers, settings, or menus are not shown.

## Renderer boundary

React owns transient interface state, including active tool, hidden feature classes, viewport, and selection. OpenLayers objects, theme definitions, and decoded asset URLs live behind the map adapter and render a snapshot only; they never become storage. The selected theme identifier, grid visibility, export scale, and export extent are bounded project settings that survive reopening. Per-feature appearance, lock, visibility, order, and asset identifiers that must survive reopening are plain validated properties in the `.realmmap`, never renderer objects or external paths.

Physical terrain, forest, and lake polygons render below political overlays. Countries and regions use distinct translucent fills, borders, and map labels; regions use the lighter boundary treatment. Roads and hydrographic lines use independent casing and stroke treatments. Coastlines, explicit boundaries, point symbols, labels, cities, and towns remain legible above area fills. This presentation order is derived from feature class and never changes stored geometry.

## App icon assets

`app/src-tauri/icons/icon.png` is the transparent master for the bundled app icon. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master with the Tauri icon command. `pnpm icon:check` verifies transparent corners and opaque subject pixels in both the PNG files and the PNG representations embedded in the ICNS container.
