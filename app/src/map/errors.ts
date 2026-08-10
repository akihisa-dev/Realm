export const MAP_ERROR_CODES = [
  "drawing_coordinate_shape",
  "drawing_outside_world",
  "drawing_coordinate_collection",
  "drawing_too_small",
  "drawing_ring_open",
  "drawing_self_intersection",
  "drawing_zero_area",
  "drawing_line_too_short",
  "drawing_ring_too_short",
  "drawing_invalid_geometry",
  "drawing_gesture",
  "drawing_smoothing",
  "drawing_unsupported_geometry",
  "drawing_missing_ring",
  "drawing_angle",
  "drawing_zero_length",
  "feature_outside_world",
] as const;

export type MapErrorCode = typeof MAP_ERROR_CODES[number];

export class DrawingGeometryError extends Error {
  readonly code: MapErrorCode;

  constructor(code: MapErrorCode) {
    super(code);
    this.name = "DrawingGeometryError";
    this.code = code;
  }
}

export const mapErrorCode = (cause: unknown): MapErrorCode =>
  cause instanceof DrawingGeometryError ? cause.code : "drawing_invalid_geometry";
