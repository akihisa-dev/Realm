export type PaletteRect = { left: number; top: number; right: number; bottom: number };
export type PaletteFlyoutPosition = { left: number; top: number; side: "right" | "left" | "bottom" | "top" };

type Viewport = { width: number; height: number };
type FlyoutSize = { width: number; height: number };

const PALETTE_RADIUS = 30;

const isFiniteRect = (rect: PaletteRect): boolean =>
  Number.isFinite(rect.left)
  && Number.isFinite(rect.top)
  && Number.isFinite(rect.right)
  && Number.isFinite(rect.bottom);

const hasArea = (rect: PaletteRect): boolean => rect.right > rect.left && rect.bottom > rect.top;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const safeViewport = (viewport: Viewport): Viewport => ({
  width: Number.isFinite(viewport.width) && viewport.width > 0 ? viewport.width : 1,
  height: Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : 1,
});

const safeSize = (size: FlyoutSize): FlyoutSize => ({
  width: Number.isFinite(size.width) && size.width > 0 ? size.width : 1,
  height: Number.isFinite(size.height) && size.height > 0 ? size.height : 1,
});

const safePaletteRect = (palette: PaletteRect): PaletteRect => {
  if (!isFiniteRect(palette)) return { left: 0, top: 0, right: 0, bottom: 0 };
  if (hasArea(palette)) return palette;
  return {
    left: palette.left - PALETTE_RADIUS,
    top: palette.top - PALETTE_RADIUS,
    right: palette.left + PALETTE_RADIUS,
    bottom: palette.top + PALETTE_RADIUS,
  };
};

const safeAnchorRect = (anchor: PaletteRect): PaletteRect =>
  isFiniteRect(anchor) && hasArea(anchor)
    ? anchor
    : { left: 0, top: 0, right: 1, bottom: 1 };

const overlaps = (a: PaletteRect, b: PaletteRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Chooses the nearest viewport-fitting position outside the palette. */
export const positionPaletteFlyout = (
  palette: PaletteRect,
  anchor: PaletteRect,
  viewport: Viewport,
  size: FlyoutSize,
  gap = 12,
): PaletteFlyoutPosition => {
  const boundedViewport = safeViewport(viewport);
  const boundedSize = safeSize(size);
  const boundedPalette = safePaletteRect(palette);
  const boundedAnchor = safeAnchorRect(anchor);
  const candidates: PaletteFlyoutPosition[] = [
    { left: boundedAnchor.right + gap, top: boundedAnchor.top + (boundedAnchor.bottom - boundedAnchor.top - boundedSize.height) / 2, side: "right" },
    { left: boundedAnchor.left - gap - boundedSize.width, top: boundedAnchor.top + (boundedAnchor.bottom - boundedAnchor.top - boundedSize.height) / 2, side: "left" },
    { left: boundedAnchor.left + (boundedAnchor.right - boundedAnchor.left - boundedSize.width) / 2, top: boundedAnchor.bottom + gap, side: "bottom" },
    { left: boundedAnchor.left + (boundedAnchor.right - boundedAnchor.left - boundedSize.width) / 2, top: boundedAnchor.top - gap - boundedSize.height, side: "top" },
  ];
  const fits = (candidate: PaletteFlyoutPosition) => {
    const rect = { left: candidate.left, top: candidate.top, right: candidate.left + boundedSize.width, bottom: candidate.top + boundedSize.height };
    return rect.left >= 0 && rect.top >= 0 && rect.right <= boundedViewport.width && rect.bottom <= boundedViewport.height && !overlaps(rect, boundedPalette);
  };
  const clampedCandidates = candidates.map((candidate) => ({
    ...candidate,
    left: clamp(candidate.left, 0, Math.max(0, boundedViewport.width - boundedSize.width)),
    top: clamp(candidate.top, 0, Math.max(0, boundedViewport.height - boundedSize.height)),
  }));
  return candidates.find(fits)
    ?? clampedCandidates.find((candidate) => !overlaps({
      left: candidate.left,
      top: candidate.top,
      right: candidate.left + boundedSize.width,
      bottom: candidate.top + boundedSize.height,
    }, boundedPalette))
    ?? clampedCandidates[0]
    ?? { left: 0, top: 0, side: "right" };
};
