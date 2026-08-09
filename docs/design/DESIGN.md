# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- [Startup concept](concepts/initial-startup.png): no project is open; only create and open are available.
- [Editor concept](concepts/initial-editor.png): a project is open; pan, zoom, year selection, era and event editing, feature drawing and selection, undo, redo, save, close, create, and open are available.

The concept images define composition and density. Visible controls remain code-native. The primary rail exposes the nine manual feature classes; the sidebar lists visible features and edits the selected feature, named eras, and timeline events.

## Visual system

- Backgrounds are true white and cool neutral gray. Do not introduce cream, fantasy parchment, gradients, or decorative texture into the editing view.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses one native overlay title bar with a compact file toolbar, a narrow primary rail, a project sidebar, a dominant OpenLayers canvas, and a bottom year control. The rail and sidebar continue to the bottom edge while the year control stays directly under the map. Do not draw a second set of macOS traffic lights in React. At smaller widths the project sidebar may collapse, but the map and current year remain usable. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

## Allowed initial copy

The startup state uses `Realm`, `創作世界の地図と歴史を、ひとつのファイルに。`, `新しい世界を作成`, and `既存の世界を開く`. The editor uses the project name, `新規`, `開く`, `保存`, `閉じる`, `元に戻す`, `やり直す`, `世界`, feature class names, the feature count, named eras, timeline events, the current year, the current era or `時代未設定`, and the zoom value. Controls for unavailable layers, settings, or menus are not shown.

## Renderer boundary

React owns transient interface state. OpenLayers objects live behind the map adapter and render a snapshot only; they never become storage. Later viewing styles must be implemented behind this boundary rather than changing the `.realmmap` source data.

## App icon assets

`app/src-tauri/icons/icon.png` is the transparent master for the bundled app icon. The white rounded tile and contour mark remain opaque, while every outer corner must be transparent. The other PNG sizes and `icon.icns` are generated from that master with the Tauri icon command. `pnpm icon:check` verifies transparent corners and opaque subject pixels in both the PNG files and the PNG representations embedded in the ICNS container.
