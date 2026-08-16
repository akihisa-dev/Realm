import type { GeoJsonGeometry, ObjectKind, Properties } from "../../shared/realmContract";
import { invalid } from "./errors";

export const MAX_FEATURE_PROPERTIES_BYTES = 32 * 1024;
export const MAX_COORDINATES = 4096;
export const MAX_GEOMETRY_BYTES = 512 * 1024;
const MIN_POLYGON_AREA = 1e-8;
const EPSILON = 1e-12;

type GeometryKind = ObjectKind | "terrain" | "region";
const geometryKind: Record<GeometryKind, GeoJsonGeometry["type"]> = {
  city: "Point", text: "Point", mountain: "Point", forest: "Polygon", terrain: "Polygon", region: "Polygon",
};

/** Geometry validation for the layer-native object registry. */
export function validateObjectGeometry(kind: "city" | "text" | "mountain" | "forest", geometry: unknown, strict = true): string {
  return validateGeometry(kind, geometry, strict);
}

export function validateName(name: string): string {
  if (typeof name !== "string") throw invalid("A project or object name is required.");
  const value = name.trim();
  if (!value) throw invalid("A project or object name is required.");
  if ([...value].length > 200) throw invalid("The name is too long.");
  return value;
}

function coordinate(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== "number" || !Number.isFinite(part))) throw invalid("Geometry coordinates must contain finite longitude and latitude.");
  const longitude = (value as number[])[0]!;
  const latitude = (value as number[])[1]!;
  if (longitude < -180 || longitude > 180) throw invalid("Geometry longitude must be between -180 and 180.");
  if (latitude < -90 || latitude > 90) throw invalid("Geometry latitude must be between -90 and 90.");
  return [longitude, latitude];
}

const orientation = (a: readonly number[], b: readonly number[], c: readonly number[]): number => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
const onSegment = (a: readonly number[], b: readonly number[], p: readonly number[]): boolean => p[0]! >= Math.min(a[0]!, b[0]!) - EPSILON && p[0]! <= Math.max(a[0]!, b[0]!) + EPSILON && p[1]! >= Math.min(a[1]!, b[1]!) - EPSILON && p[1]! <= Math.max(a[1]!, b[1]!) + EPSILON;
const intersects = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
  const abC = orientation(a, b, c); const abD = orientation(a, b, d); const cdA = orientation(c, d, a); const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return Math.abs(abC) <= EPSILON && onSegment(a, b, c) || Math.abs(abD) <= EPSILON && onSegment(a, b, d) || Math.abs(cdA) <= EPSILON && onSegment(c, d, a) || Math.abs(cdB) <= EPSILON && onSegment(c, d, b);
};
const pointInRing = (point: readonly number[], ring: readonly (readonly number[])[]): boolean => {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i]!; const b = ring[i + 1]!;
    if ((a[1]! > point[1]!) !== (b[1]! > point[1]!) && point[0]! < (b[0]! - a[0]!) * (point[1]! - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
};

function strictRing(raw: unknown): [number, number][] {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > MAX_COORDINATES) throw invalid("Polygon rings contain too many or too few coordinates.");
  const ring = raw.map(coordinate);
  if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1]) throw invalid("Polygon rings must be closed.");
  if (ring.length < 4) throw invalid("Polygon rings contain too many or too few coordinates.");
  for (let i = 0; i < ring.length - 1; i += 1) if (ring[i]![0] === ring[i + 1]![0] && ring[i]![1] === ring[i + 1]![1] && i !== ring.length - 2) throw invalid("Polygon rings must not contain duplicate adjacent positions.");
  for (let a = 0; a < ring.length - 1; a += 1) for (let b = a + 1; b < ring.length - 1; b += 1) {
    if (b === a + 1 || (a === 0 && b === ring.length - 2)) continue;
    if (intersects(ring[a]!, ring[a + 1]!, ring[b]!, ring[b + 1]!)) throw invalid("Polygon rings must not self-intersect.");
  }
  const area = ring.slice(0, -1).reduce((sum, p, i) => sum + p[0]! * ring[i + 1]![1]! - ring[i + 1]![0]! * p[1]!, 0) / 2;
  if (Math.abs(area) < MIN_POLYGON_AREA) throw invalid("Polygon rings must have a non-zero minimum area.");
  return ring;
}

export function validateGeometry(kind: GeometryKind, geometry: unknown, strict = true): string {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) throw invalid("Geometry must be a GeoJSON geometry object.");
  const object = geometry as { type?: unknown; coordinates?: unknown };
  if (object.type !== geometryKind[kind]) throw invalid("Geometry type does not match the selected object or layer.");
  const coordinates = object.coordinates;
  let encoded: string;
  try { encoded = JSON.stringify(geometry); } catch { throw invalid("Geometry could not be encoded as GeoJSON."); }
  if (strict && new TextEncoder().encode(encoded).length > MAX_GEOMETRY_BYTES) throw invalid("Geometry is too large.");
  if (object.type === "Point") coordinate(coordinates);
  else if (object.type === "LineString") {
    if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > MAX_COORDINATES) throw invalid("LineString contains too many or too few coordinates.");
    const points = coordinates.map(coordinate);
    for (let i = 0; i < points.length - 1; i += 1) if (points[i]![0] === points[i + 1]![0] && points[i]![1] === points[i + 1]![1]) throw invalid("LineString coordinates must be distinct.");
  } else {
    if (!Array.isArray(coordinates) || coordinates.length < 1) throw invalid("A polygon must contain at least one ring.");
    if (!strict) {
      coordinates.forEach((ring) => { if (!Array.isArray(ring) || ring.length < 4) throw invalid("A polygon ring is invalid."); ring.forEach(coordinate); });
    } else {
      const rings = coordinates.map(strictRing);
      const total = rings.reduce((sum, ring) => sum + ring.length, 0);
      if (total > MAX_COORDINATES) throw invalid("Geometry contains too many coordinates.");
      const shell = rings[0]!;
      for (const hole of rings.slice(1)) {
        if (!pointInRing(hole[0]!, shell) || shell.some((a, i) => i < shell.length - 1 && hole.some((b, j) => j < hole.length - 1 && intersects(a, shell[i + 1]!, b, hole[j + 1]!)))) throw invalid("Polygon holes must be strictly contained by the outer ring.");
      }
      for (let i = 1; i < rings.length; i += 1) for (let j = i + 1; j < rings.length; j += 1) if (pointInRing(rings[i]![0]!, rings[j]!) || pointInRing(rings[j]![0]!, rings[i]!) || rings[i]!.some((a, k) => k < rings[i]!.length - 1 && rings[j]!.some((b, l) => l < rings[j]!.length - 1 && intersects(a, rings[i]![k + 1]!, b, rings[j]![l + 1]!)))) throw invalid("Polygon holes must not intersect or contain one another.");
    }
  }
  return encoded;
}

export function validateProperties(properties: unknown): Properties {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw invalid("Object properties must be an object.");
  let encoded: string;
  try {
    encoded = JSON.stringify(properties, (_key, value) => {
      if (value === undefined || typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") throw invalid("Object properties must contain JSON values.");
      return value;
    });
  } catch (error) {
    if (error instanceof Error && error.name === "RealmError") throw error;
    throw invalid("Object properties must contain JSON values.");
  }
  if (new TextEncoder().encode(encoded).length > MAX_FEATURE_PROPERTIES_BYTES) throw invalid("Object properties are too large.");
  return properties as Properties;
}
