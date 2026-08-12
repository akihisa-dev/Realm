export type PaletteRect = { left: number; top: number; right: number; bottom: number };
export type PaletteFlyoutPosition = { left: number; top: number; side: "right" | "left" | "bottom" | "top" };

type Viewport = { width: number; height: number };

const overlaps = (a: PaletteRect, b: PaletteRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Chooses the nearest viewport-fitting position outside the palette. */
export const positionPaletteFlyout = (
  palette: PaletteRect,
  anchor: PaletteRect,
  viewport: Viewport,
  size: { width: number; height: number },
  gap = 12,
): PaletteFlyoutPosition => {
  const candidates: PaletteFlyoutPosition[] = [
    { left: anchor.right + gap, top: anchor.top + (anchor.bottom - anchor.top - size.height) / 2, side: "right" },
    { left: anchor.left - gap - size.width, top: anchor.top + (anchor.bottom - anchor.top - size.height) / 2, side: "left" },
    { left: anchor.left + (anchor.right - anchor.left - size.width) / 2, top: anchor.bottom + gap, side: "bottom" },
    { left: anchor.left + (anchor.right - anchor.left - size.width) / 2, top: anchor.top - gap - size.height, side: "top" },
  ];
  const fits = (candidate: PaletteFlyoutPosition) => {
    const rect = { left: candidate.left, top: candidate.top, right: candidate.left + size.width, bottom: candidate.top + size.height };
    return rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height && !overlaps(rect, palette);
  };
  return candidates.find(fits) ?? candidates.map((candidate) => ({
    ...candidate,
    left: Math.max(0, Math.min(viewport.width - size.width, candidate.left)),
    top: Math.max(0, Math.min(viewport.height - size.height, candidate.top)),
  })).find((candidate) => !overlaps({ left: candidate.left, top: candidate.top, right: candidate.left + size.width, bottom: candidate.top + size.height }, palette)) ?? candidates[0]!;
};
