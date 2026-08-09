# Realm design source

## Purpose

Realm's editing surface stays quiet so the map remains the dominant object. The initial interface is a macOS utility, not a dashboard or a fantasy-themed presentation. Viewing styles may become richer later, but they must remain derived renderers over the same project data.

## Initial states

- [Startup concept](concepts/initial-startup.png): no project is open; only create and open are available.
- [Editor concept](concepts/initial-editor.png): an empty project is open; pan, zoom, year selection, era editing, save, close, create, and open are available.

The concept images define composition and density. Visible controls remain code-native and unavailable feature-editing tools are not shown.

## Visual system

- Backgrounds are true white and cool neutral gray. Do not introduce cream, fantasy parchment, gradients, or decorative texture into the editing view.
- Text is charcoal with a restrained deep blue-green or cool blue selection accent.
- Use the macOS system font stack. Controls use explicit compact typography rather than browser defaults.
- Prefer rails, separators, lists, and the full map canvas over nested cards or floating panels.
- Borders are thin and low contrast. Shadows are limited to controls that must sit over the canvas.
- Keyboard focus remains visible and motion respects `prefers-reduced-motion`.

## Layout contract

The editor uses a compact file toolbar, a narrow primary rail, a project sidebar, a dominant OpenLayers canvas, and a bottom year control. At smaller widths the project sidebar may collapse, but the map and current year remain usable. Default zoom and center are part of the map adapter contract and must not be persisted as project data.

## Allowed initial copy

The startup state uses `Realm`, `創作世界の地図と歴史を、ひとつのファイルに。`, `新しい世界を作成`, and `既存の世界を開く`. The empty editor uses the project name, `新規`, `開く`, `保存`, `閉じる`, `世界`, the feature count, named eras, the current year, the current era or `時代未設定`, and the zoom value. Controls for unavailable feature editing, layers, settings, or menus are not shown.

## Renderer boundary

React owns transient interface state. OpenLayers objects live behind the map adapter and render a snapshot only; they never become storage. Later viewing styles must be implemented behind this boundary rather than changing the `.realmmap` source data.
