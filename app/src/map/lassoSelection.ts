import type { GeoJsonGeometry, MapObject, Position } from "../backend";

type Segment = readonly [Position, Position];

const samePosition = (first: Position, second: Position): boolean => first[0] === second[0] && first[1] === second[1];

const orientation = (first: Position, second: Position, third: Position): number =>
  (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);

const onSegment = (first: Position, second: Position, point: Position): boolean =>
  point[0] >= Math.min(first[0], second[0]) && point[0] <= Math.max(first[0], second[0])
  && point[1] >= Math.min(first[1], second[1]) && point[1] <= Math.max(first[1], second[1]);

const segmentsIntersect = (first: Segment, second: Segment): boolean => {
  const epsilon = 1e-10;
  const [a, b] = first;
  const [c, d] = second;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  return (Math.abs(abC) <= epsilon && onSegment(a, b, c))
    || (Math.abs(abD) <= epsilon && onSegment(a, b, d))
    || (Math.abs(cdA) <= epsilon && onSegment(c, d, a))
    || (Math.abs(cdB) <= epsilon && onSegment(c, d, b));
};

const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  if (ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const current = ring[index]!;
    const prior = ring[previous]!;
    if (segmentsIntersect([prior, current], [point, point])) return true;
    const crosses = (current[1] > point[1]) !== (prior[1] > point[1]);
    if (crosses && point[0] < ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0]) inside = !inside;
  }
  return inside;
};

const pointInPolygon = (point: Position, rings: readonly (readonly Position[])[]): boolean =>
  rings.length > 0 && pointInRing(point, rings[0]!) && rings.slice(1).every((hole) => !pointInRing(point, hole));

const ringSegments = (ring: readonly Position[]): Segment[] => {
  if (ring.length < 2) return [];
  const segments: Segment[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const next = (index + 1) % ring.length;
    if (!samePosition(ring[index]!, ring[next]!)) segments.push([ring[index]!, ring[next]!]);
  }
  return segments;
};

const geometryCoordinates = (geometry: GeoJsonGeometry): Position[][] => {
  if (geometry.type === "Point") return [[geometry.coordinates]];
  if (geometry.type === "LineString") return [geometry.coordinates];
  return geometry.coordinates;
};

const geometryIntersectsLasso = (geometry: GeoJsonGeometry, lassoRing: readonly Position[]): boolean => {
  const lassoSegments = ringSegments(lassoRing);
  const coordinates = geometryCoordinates(geometry);
  if (geometry.type === "Point") return pointInRing(geometry.coordinates, lassoRing);

  // A vertex in either polygon is enough for containment; segment checks cover
  // the case where two shapes cross without containing one another's vertices.
  if (coordinates.some((line) => line.some((point) => pointInRing(point, lassoRing)))) return true;
  if (geometry.type === "Polygon" && lassoRing.some((point) => pointInPolygon(point, geometry.coordinates))) return true;

  const geometrySegments = coordinates.flatMap((line) => {
    const segments: Segment[] = [];
    for (let index = 1; index < line.length; index += 1) segments.push([line[index - 1]!, line[index]!]);
    if (geometry.type === "Polygon" && line.length > 1 && !samePosition(line[0]!, line[line.length - 1]!)) segments.push([line[line.length - 1]!, line[0]!]);
    return segments;
  });
  return geometrySegments.some((segment) => lassoSegments.some((lassoSegment) => segmentsIntersect(segment, lassoSegment)));
};

/** Returns feature ids whose geometry intersects or is contained by a lasso. */
export const selectObjectIdsWithinLasso = (
  objects: readonly Pick<MapObject, "id" | "geometry">[],
  lasso: readonly Position[],
): string[] => {
  const valid = lasso.length >= 3 && lasso.every((point) => point.length === 2 && point.every(Number.isFinite));
  if (!valid) return [];
  const ring = samePosition(lasso[0]!, lasso[lasso.length - 1]!) ? [...lasso] : [...lasso, lasso[0]!];
  return objects.filter((object) => geometryIntersectsLasso(object.geometry, ring)).map((object) => object.id);
};
