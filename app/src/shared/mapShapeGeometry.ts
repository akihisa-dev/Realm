import type { MapShape, MapShapeGeometry, MapShapeLayer, Position } from "./realmContract";

export const MAP_SHAPE_GEOMETRY_VERSION = 1;
export const MAP_SHAPE_GRID_VERSION = 2;
export const MAP_SHAPE_WORLD_EXTENT = [-180, -90, 180, 90] as const;
export const MAP_SHAPE_GRID_COLUMNS = 128;
export const MAP_SHAPE_GRID_ROWS = 73;
const EPSILON = 1e-8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

type Cell = { row: number; column: number };
type CellGroup = { layer: MapShapeLayer; value: string; regionId?: string; cells: Set<string> };

const cellId = ({ row, column }: Cell): string => `${column}:${row}`;
const parseCellId = (value: string): Cell | null => {
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  const column = Number(match[1]);
  const row = Number(match[2]);
  return Number.isSafeInteger(column) && Number.isSafeInteger(row)
    && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS && row >= 0 && row < MAP_SHAPE_GRID_ROWS
    ? { row, column }
    : null;
};

const radius = 180 / (1.5 * MAP_SHAPE_GRID_ROWS + 0.5);
const columnStep = Math.sqrt(3) * radius;
const rowStep = 1.5 * radius;
const firstCenter: Position = [-180 + columnStep / 2, -90 + radius];

const clipPolygonToWorld = (polygon: readonly Position[]): Position[] => {
  let clipped = polygon.map(([x, y]) => [x, y] as Position);
  const edges: readonly ((point: Position) => boolean)[] = [
    ([x]) => x >= MAP_SHAPE_WORLD_EXTENT[0] - EPSILON,
    ([, y]) => y >= MAP_SHAPE_WORLD_EXTENT[1] - EPSILON,
    ([x]) => x <= MAP_SHAPE_WORLD_EXTENT[2] + EPSILON,
    ([, y]) => y <= MAP_SHAPE_WORLD_EXTENT[3] + EPSILON,
  ];
  const intersections: readonly ((start: Position, end: Position) => Position)[] = [
    ([x1, y1], [x2, y2]) => [MAP_SHAPE_WORLD_EXTENT[0], y1 + (y2 - y1) * (MAP_SHAPE_WORLD_EXTENT[0] - x1) / (x2 - x1)],
    ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * (MAP_SHAPE_WORLD_EXTENT[1] - y1) / (y2 - y1), MAP_SHAPE_WORLD_EXTENT[1]],
    ([x1, y1], [x2, y2]) => [MAP_SHAPE_WORLD_EXTENT[2], y1 + (y2 - y1) * (MAP_SHAPE_WORLD_EXTENT[2] - x1) / (x2 - x1)],
    ([x1, y1], [x2, y2]) => [x1 + (x2 - x1) * (MAP_SHAPE_WORLD_EXTENT[3] - y1) / (y2 - y1), MAP_SHAPE_WORLD_EXTENT[3]],
  ];
  for (let edge = 0; edge < edges.length && clipped.length > 0; edge += 1) {
    const inside = edges[edge]!;
    const intersect = intersections[edge]!;
    const next: Position[] = [];
    for (let index = 0; index < clipped.length; index += 1) {
      const start = clipped[index]!;
      const end = clipped[(index + 1) % clipped.length]!;
      const startInside = inside(start);
      const endInside = inside(end);
      if (startInside !== endInside) {
        const candidate = intersect(start, end);
        if (candidate.every(Number.isFinite)) next.push(candidate);
      }
      if (endInside) next.push(end);
    }
    clipped = next;
  }
  return clipped;
};

export const mapShapeCellCenter = (cell: Cell): Position => [
  firstCenter[0] + (cell.column + (cell.row % 2 === 0 ? 0 : 0.5)) * columnStep,
  firstCenter[1] + cell.row * rowStep,
];

export const mapShapeCellPolygon = (cell: Cell): Position[] | null => {
  if (cell.row < 0 || cell.row >= MAP_SHAPE_GRID_ROWS || cell.column < 0 || cell.column >= MAP_SHAPE_GRID_COLUMNS) return null;
  const [centerX, centerY] = mapShapeCellCenter(cell);
  const polygon = Array.from({ length: 6 }, (_, vertex): Position => {
    const angle = ((-90 + vertex * 60) * Math.PI) / 180;
    return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)];
  });
  const clipped = clipPolygonToWorld(polygon);
  return clipped.length >= 3 ? [...clipped, [...clipped[0]!] as Position] : null;
};

const coordinateKey = ([x, y]: Position): string => `${x.toFixed(9)},${y.toFixed(9)}`;
const edgeKey = (start: Position, end: Position): string => {
  const first = coordinateKey(start);
  const second = coordinateKey(end);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
};
const ringArea = (ring: readonly Position[]): number => {
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) area += ring[index - 1]![0] * ring[index]![1] - ring[index]![0] * ring[index - 1]![1];
  return area / 2;
};
const pointInRing = (point: Position, ring: readonly Position[]): boolean => {
  let inside = false;
  for (let index = 1; index < ring.length; index += 1) {
    const a = ring[index - 1]!;
    const b = ring[index]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** The exposed edges of a cell set, joined into deterministic rings. */
export const cellIdsToRings = (cellIds: Iterable<string>): Position[][] => {
  const edges = new Map<string, { count: number; start: Position; end: Position }>();
  for (const id of new Set(cellIds)) {
    const cell = parseCellId(id);
    const polygon = cell ? mapShapeCellPolygon(cell) : null;
    if (!polygon) continue;
    for (let index = 1; index < polygon.length; index += 1) {
      const start = [...polygon[index - 1]!] as Position;
      const end = [...polygon[index]!] as Position;
      const key = edgeKey(start, end);
      const previous = edges.get(key);
      if (previous) previous.count += 1;
      else edges.set(key, { count: 1, start, end });
    }
  }
  const exposed = [...edges.values()].filter(({ count }) => count === 1);
  const outgoing = new Map<string, typeof exposed>();
  for (const edge of exposed) {
    const list = outgoing.get(coordinateKey(edge.start)) ?? [];
    list.push(edge);
    outgoing.set(coordinateKey(edge.start), list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => coordinateKey(a.end).localeCompare(coordinateKey(b.end)));
  const identity = (edge: typeof exposed[number]): string => `${coordinateKey(edge.start)}>${coordinateKey(edge.end)}`;
  const used = new Set<string>();
  const rings: Position[][] = [];
  for (const seed of exposed.slice().sort((a, b) => identity(a).localeCompare(identity(b)))) {
    if (used.has(identity(seed))) continue;
    const ring: Position[] = [[...seed.start] as Position];
    let current = seed;
    let closed = false;
    for (let guard = 0; guard < 65536; guard += 1) {
      used.add(identity(current));
      ring.push([...current.end] as Position);
      if (coordinateKey(current.end) === coordinateKey(ring[0]!)) { closed = true; break; }
      const next = (outgoing.get(coordinateKey(current.end)) ?? []).find((candidate) => !used.has(identity(candidate)));
      if (!next) break;
      current = next;
    }
    if (closed && ring.length >= 4 && Math.abs(ringArea(ring)) > EPSILON) rings.push(ring);
  }
  return rings;
};

const ringsToPolygons = (rings: readonly Position[][]): Position[][][] => {
  const shells = rings.filter((ring) => ringArea(ring) > 0);
  const holes = rings.filter((ring) => ringArea(ring) < 0);
  const polygons = shells.map((shell) => [shell.map((point) => [...point] as Position)]);
  for (const hole of holes) {
    const owner = polygons.find(([shell]) => shell && pointInRing(hole[0]!, shell));
    if (owner) owner.push(hole.map((point) => [...point] as Position));
  }
  return polygons;
};

export const cellIdsToPolygonGeometries = (cellIds: Iterable<string>): MapShapeGeometry[] =>
  ringsToPolygons(cellIdsToRings(cellIds)).map((coordinates) => ({ type: "Polygon", coordinates }));

const samePoint = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0]! - b[0]!) <= EPSILON && Math.abs(a[1]! - b[1]!) <= EPSILON;
const orientation = (a: readonly number[], b: readonly number[], c: readonly number[]): number =>
  (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
const pointOnSegment = (a: readonly number[], b: readonly number[], point: readonly number[]): boolean =>
  point[0]! >= Math.min(a[0]!, b[0]!) - EPSILON && point[0]! <= Math.max(a[0]!, b[0]!) + EPSILON
  && point[1]! >= Math.min(a[1]!, b[1]!) - EPSILON && point[1]! <= Math.max(a[1]!, b[1]!) + EPSILON;
const segmentsIntersect = (a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean => {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && pointOnSegment(a, b, c))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(a, b, d))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(c, d, a))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(c, d, b));
};
const ringSelfIntersects = (ring: readonly Position[]): boolean => {
  const segments = ring.length - 1;
  for (let first = 0; first < segments; first += 1) {
    for (let second = first + 1; second < segments; second += 1) {
      if (second === first + 1 || (first === 0 && second === segments - 1)) continue;
      if (segmentsIntersect(ring[first]!, ring[first + 1]!, ring[second]!, ring[second + 1]!)) return true;
    }
  }
  return false;
};

const geometryCellIds = (geometry: MapShapeGeometry): Set<string> => {
  const cells = new Set<string>();
  for (let row = 0; row < MAP_SHAPE_GRID_ROWS; row += 1) {
    for (let column = 0; column < MAP_SHAPE_GRID_COLUMNS; column += 1) {
      const point = mapShapeCellCenter({ row, column });
      const inShell = geometry.coordinates[0] ? pointInRing(point, geometry.coordinates[0]) : false;
      const inHole = geometry.coordinates.slice(1).some((ring) => pointInRing(point, ring));
      if (inShell && !inHole) cells.add(`${column}:${row}`);
    }
  }
  return cells;
};

export const mapShapeCellIds = (shape: Pick<MapShape, "geometry">): Set<string> => geometryCellIds(shape.geometry);

const canonicalGeometrySignature = (geometry: MapShapeGeometry): string => JSON.stringify(geometry);

const validateGeometry = (geometry: MapShapeGeometry): Set<string> => {
  if (geometry.type !== "Polygon" || geometry.coordinates.length === 0 || geometry.coordinates.length > 64) throw new Error("形状のポリゴンが不正です。");
  for (const ring of geometry.coordinates) {
    if (ring.length < 4 || ring.length > 4096 || !samePoint(ring[0]!, ring.at(-1)!) || ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y) || x < -180 - EPSILON || x > 180 + EPSILON || y < -90 - EPSILON || y > 90 + EPSILON)) throw new Error("形状のリングが不正です。");
    for (let index = 1; index < ring.length; index += 1) if (samePoint(ring[index - 1]!, ring[index]!)) throw new Error("形状のリングに重複座標があります。");
    if (Math.abs(ringArea(ring)) <= EPSILON || ringSelfIntersects(ring)) throw new Error("形状のリングが自己交差または退化しています。");
  }
  const shell = geometry.coordinates[0]!;
  for (const hole of geometry.coordinates.slice(1)) {
    if (!pointInRing(hole[0]!, shell) || segmentsIntersect(hole[0]!, hole[1]!, shell[0]!, shell[1]!)) throw new Error("形状の穴が外周の内側にありません。");
  }
  const cells = geometryCellIds(geometry);
  if (cells.size === 0) throw new Error("形状にグリッドセルがありません。");
  const parts = cellIdsToPolygonGeometries(cells);
  if (parts.length !== 1 || canonicalGeometrySignature(parts[0]!) !== canonicalGeometrySignature(geometry)) throw new Error("形状は固定グリッドに整列している必要があります。");
  return cells;
};

export const validateMapShape = (shape: MapShape): Set<string> => {
  if (!shape || typeof shape !== "object" || !UUID_PATTERN.test(shape.id)) throw new Error("形状IDが不正です。");
  if (shape.layer !== "terrain" && shape.layer !== "region") throw new Error("形状レイヤーが不正です。");
  if (!Number.isInteger(shape.geometryVersion) || shape.geometryVersion !== MAP_SHAPE_GEOMETRY_VERSION || !Number.isInteger(shape.snapGridVersion) || shape.snapGridVersion !== MAP_SHAPE_GRID_VERSION) throw new Error("形状バージョンが不正です。");
  if (shape.layer === "terrain" && (shape.regionId !== undefined || shape.value !== "terrain")) throw new Error("地形形状の属性が不正です。");
  if (shape.layer === "region" && (!shape.regionId || !UUID_PATTERN.test(shape.regionId) || !/^#[\da-f]{6}$/iu.test(shape.value))) throw new Error("領域形状の属性が不正です。");
  return validateGeometry(shape.geometry);
};

export const validateMapShapes = (shapes: readonly MapShape[]): void => {
  if (!Array.isArray(shapes) || shapes.length > 4096) throw new Error("形状の件数が不正です。");
  const ids = new Set<string>();
  const occupied = new Map<MapShapeLayer, Set<string>>([['terrain', new Set()], ['region', new Set()]]);
  const regionValues = new Map<string, string>();
  for (const shape of shapes) {
    if (ids.has(shape.id)) throw new Error("形状IDが重複しています。");
    ids.add(shape.id);
    const cells = validateMapShape(shape);
    if (shape.layer === "region") {
      const previous = regionValues.get(shape.regionId!);
      if (previous !== undefined && previous !== shape.value) throw new Error("同じ領域IDに複数の色を設定できません。");
      regionValues.set(shape.regionId!, shape.value);
    }
    const layerCells = occupied.get(shape.layer)!;
    for (const cell of cells) if (layerCells.has(cell)) throw new Error("同じレイヤーの形状を重ねることはできません。");
    for (const cell of cells) layerCells.add(cell);
  }
};

const newId = (): string => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = (length: number): string => Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${["8", "9", "a", "b"][Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
};
const componentNeighbors = (cell: Cell): Cell[] => {
  const axialQ = cell.column - Math.floor(cell.row / 2);
  return ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]] as const).flatMap(([dq, drow]) => {
    const row = cell.row + drow;
    const column = axialQ + dq + Math.floor(row / 2);
    return row >= 0 && row < MAP_SHAPE_GRID_ROWS && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS ? [{ row, column }] : [];
  });
};
const connectedComponents = (cells: Set<string>): Set<string>[] => {
  const remaining = new Set(cells);
  const components: Set<string>[] = [];
  while (remaining.size > 0) {
    const seed = [...remaining].sort()[0]!;
    const queue = [seed];
    const component = new Set<string>();
    remaining.delete(seed);
    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index]!;
      component.add(currentId);
      const current = parseCellId(currentId);
      if (!current) continue;
      for (const neighbor of componentNeighbors(current)) {
        const neighborId = cellId(neighbor);
        if (remaining.delete(neighborId)) queue.push(neighborId);
      }
    }
    components.push(component);
  }
  return components;
};

type ExistingPart = { shape: MapShape; cells: Set<string> };
const shapeParts = (shapes: readonly MapShape[]): ExistingPart[] => shapes.map((shape) => ({ shape, cells: mapShapeCellIds(shape) }));
const geometryForCells = (cells: Set<string>): MapShapeGeometry => {
  const [geometry] = cellIdsToPolygonGeometries(cells);
  if (!geometry) throw new Error("形状を構成するセルがありません。");
  return geometry;
};

const shapesFromGroups = (groups: readonly CellGroup[], existing: readonly MapShape[]): MapShape[] => {
  const parts = shapeParts(existing);
  const usedIds = new Set<string>();
  const result: MapShape[] = [];
  for (const group of groups) {
    for (const component of connectedComponents(group.cells)) {
      const candidates = parts.filter(({ shape }) => !usedIds.has(shape.id) && shape.layer === group.layer && shape.value === group.value && shape.regionId === group.regionId)
        .map((part) => ({ ...part, overlap: [...component].filter((cell) => part.cells.has(cell)).length }))
        .filter((candidate) => candidate.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap || a.shape.id.localeCompare(b.shape.id));
      const id = candidates[0]?.shape.id ?? newId();
      usedIds.add(id);
      result.push({ id, layer: group.layer, ...(group.regionId ? { regionId: group.regionId } : {}), value: group.value, geometryVersion: MAP_SHAPE_GEOMETRY_VERSION, snapGridVersion: MAP_SHAPE_GRID_VERSION, geometry: geometryForCells(component) });
    }
  }
  return result.sort((a, b) => a.layer.localeCompare(b.layer) || (a.regionId ?? "").localeCompare(b.regionId ?? "") || a.id.localeCompare(b.id));
};

const groupsFromShapes = (shapes: readonly MapShape[]): CellGroup[] => {
  const groups = new Map<string, CellGroup>();
  for (const shape of shapes) {
    const key = `${shape.layer}:${shape.regionId ?? ""}:${shape.value}`;
    const group = groups.get(key) ?? { layer: shape.layer, value: shape.value, ...(shape.regionId ? { regionId: shape.regionId } : {}), cells: new Set<string>() };
    for (const cell of mapShapeCellIds(shape)) group.cells.add(cell);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const mapShapesToCellAttributes = (shapes: readonly MapShape[]) => groupsFromShapes(shapes)
  .sort((first, second) => (first.layer === second.layer ? (first.regionId ?? "").localeCompare(second.regionId ?? "") || first.value.localeCompare(second.value) : first.layer === "terrain" ? -1 : 1))
  .flatMap((group) => [...group.cells].sort().map((cellIdValue) => ({ cellId: cellIdValue, attribute: group.layer, value: group.value, ...(group.regionId ? { regionId: group.regionId } : {}) })));

export type ApplyMapShapeSelection = { cellIds: readonly string[]; layer: "terrain" | "region"; value: string | null; regionId?: string; clearRegion?: boolean };
export const applyCellSelectionToMapShapes = (shapes: readonly MapShape[], input: ApplyMapShapeSelection): MapShape[] => {
  const selected = new Set(input.cellIds.filter((id) => parseCellId(id)));
  if (selected.size === 0) throw new Error("セルを選択してください。");
  const groups = groupsFromShapes(shapes);
  if (input.layer === "terrain") {
    const terrain = groups.find((group) => group.layer === "terrain");
    if (input.value === null) terrain?.cells.forEach((cell) => { if (selected.has(cell)) terrain.cells.delete(cell); });
    else {
      const target = terrain ?? (() => { const created: CellGroup = { layer: "terrain", value: "terrain", cells: new Set() }; groups.push(created); return created; })();
      for (const cell of selected) target.cells.add(cell);
    }
    if (input.clearRegion) for (const group of groups.filter((candidate) => candidate.layer === "region")) for (const cell of selected) group.cells.delete(cell);
  } else {
    for (const group of groups.filter((candidate) => candidate.layer === "region")) for (const cell of selected) group.cells.delete(cell);
    if (input.value !== null) {
      if (!input.regionId || !UUID_PATTERN.test(input.regionId)) throw new Error("領域IDが不正です。");
      const region = groups.find((group) => group.layer === "region" && group.regionId === input.regionId && group.value === input.value)
        ?? (() => { const created: CellGroup = { layer: "region", regionId: input.regionId, value: input.value!, cells: new Set() }; groups.push(created); return created; })();
      for (const cell of selected) region.cells.add(cell);
    }
  }
  return shapesFromGroups(groups.filter((group) => group.cells.size > 0), shapes);
};

const axial = (id: string): [number, number] | null => {
  const cell = parseCellId(id);
  return cell ? [cell.column - Math.floor(cell.row / 2), cell.row] : null;
};
const cellFromAxial = (q: number, row: number): string | null => {
  const column = q + Math.floor(row / 2);
  return row >= 0 && row < MAP_SHAPE_GRID_ROWS && column >= 0 && column < MAP_SHAPE_GRID_COLUMNS ? `${column}:${row}` : null;
};

/** Moves all parts of one region by the fixed-grid offset while preserving ids. */
export const moveRegionMapShapes = (shapes: readonly MapShape[], regionId: string, sourceCellIds: readonly string[], targetCellIds: readonly string[]): MapShape[] => {
  if (sourceCellIds.length === 0 || sourceCellIds.length !== targetCellIds.length) throw new Error("領域の移動指定が不正です。");
  const sourceOrigin = axial(sourceCellIds[0]!);
  const targetOrigin = axial(targetCellIds[0]!);
  if (!sourceOrigin || !targetOrigin) throw new Error("領域の移動指定が不正です。");
  const delta: [number, number] = [targetOrigin[0] - sourceOrigin[0], targetOrigin[1] - sourceOrigin[1]];
  const expected = sourceCellIds.map((id) => { const origin = axial(id); return origin ? cellFromAxial(origin[0] + delta[0], origin[1] + delta[1]) : null; });
  if (expected.some((id, index) => id !== targetCellIds[index])) throw new Error("領域は固定グリッド上で移動してください。");
  const regionCells = groupsFromShapes(shapes).filter((group) => group.layer === "region" && group.regionId === regionId).flatMap((group) => [...group.cells]);
  const sourceSet = new Set(sourceCellIds);
  if (regionCells.length !== sourceSet.size || regionCells.some((id) => !sourceSet.has(id))) throw new Error("領域全体を移動してください。");
  const occupied = new Set(groupsFromShapes(shapes).filter((group) => group.layer === "region" && group.regionId !== regionId).flatMap((group) => [...group.cells]));
  const moved = new Map<string, string>();
  for (const source of regionCells) {
    const origin = axial(source);
    const destination = origin ? cellFromAxial(origin[0] + delta[0], origin[1] + delta[1]) : null;
    if (!destination || (occupied.has(destination) && !sourceSet.has(destination))) throw new Error("移動先に別の領域があるため移動できません。");
    moved.set(source, destination);
  }
  return shapes.map((shape) => {
    if (shape.layer !== "region" || shape.regionId !== regionId) return shape;
    const translatedCells = new Set([...mapShapeCellIds(shape)].map((cell) => moved.get(cell)));
    if ([...translatedCells].some((cell): cell is undefined => cell === undefined)) throw new Error("領域の移動指定が不正です。");
    return { ...shape, geometry: geometryForCells(translatedCells as Set<string>) };
  });
};

export const translateMapShapeGeometry = (geometry: MapShapeGeometry, offset: Position): MapShapeGeometry => ({
  type: "Polygon",
  coordinates: geometry.coordinates.map((ring) => ring.map(([x, y]) => [x + offset[0], y + offset[1]] as Position)),
});
