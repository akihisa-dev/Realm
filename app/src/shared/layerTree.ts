import type { LayerId, LayerNode, LayerTree } from "./realmContract";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_LAYER_NODES = 4096;

const nameOf = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("レイヤー名が不正です。");
  const name = value.trim();
  if (!name || [...name].length > 200) throw new Error("レイヤー名が不正です。");
  return name;
};

export const validateLayerTree = (tree: LayerTree): LayerTree => {
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0 || tree.nodes.length > MAX_LAYER_NODES) throw new Error("レイヤー階層が不正です。");
  const ids = new Set<string>();
  const nodes = tree.nodes.map((node): LayerNode => {
    if (!node || typeof node !== "object" || !UUID_PATTERN.test(node.id) || ids.has(node.id) || (node.parentId !== null && !UUID_PATTERN.test(node.parentId)) || (node.kind !== "group" && node.kind !== "leaf") || !Number.isSafeInteger(node.order) || node.order < -1000000 || node.order > 1000000 || typeof node.visible !== "boolean" || typeof node.locked !== "boolean") throw new Error("レイヤー階層が不正です。");
    ids.add(node.id);
    return { id: node.id, parentId: node.parentId, kind: node.kind, name: nameOf(node.name), order: node.order, visible: node.visible, locked: node.locked };
  });
  if (!nodes.some((node) => node.kind === "leaf")) throw new Error("編集可能な末端レイヤーが必要です。");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const orders = new Set<string>();
  for (const node of nodes) {
    if (node.parentId !== null && (!byId.has(node.parentId) || node.parentId === node.id)) throw new Error("レイヤーの親が不正です。");
    if (node.parentId !== null && byId.get(node.parentId)?.kind === "leaf") throw new Error("末端レイヤーは子を持てません。");
    const orderKey = `${node.parentId ?? "root"}:${node.order}`;
    if (orders.has(orderKey)) throw new Error("兄弟レイヤーの順序が重複しています。");
    orders.add(orderKey);
    const seen = new Set<LayerId>();
    let current: LayerNode | undefined = node;
    while (current) {
      if (seen.has(current.id)) throw new Error("レイヤー階層が循環しています。");
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
  }
  return { nodes };
};

export type FlattenedLayerNode = LayerNode & { depth: number; effectiveVisible: boolean; effectiveLocked: boolean; renderOrder: number };

/** Deterministic depth-first order used for rendering and tree presentation. */
export const flattenLayerTree = (tree: LayerTree): FlattenedLayerNode[] => {
  const normalized = validateLayerTree(tree);
  const children = new Map<LayerId | null, LayerNode[]>();
  for (const node of normalized.nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  for (const siblings of children.values()) siblings.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const result: FlattenedLayerNode[] = [];
  const visit = (parentId: LayerId | null, depth: number, parentVisible: boolean, parentLocked: boolean): void => {
    for (const node of children.get(parentId) ?? []) {
      const effectiveVisible = parentVisible && node.visible;
      const effectiveLocked = parentLocked || node.locked;
      result.push({ ...node, depth, effectiveVisible, effectiveLocked, renderOrder: result.length });
      visit(node.id, depth + 1, effectiveVisible, effectiveLocked);
    }
  };
  visit(null, 0, true, false);
  return result;
};

export const firstEditableLeaf = (tree: LayerTree): LayerNode => flattenLayerTree(tree).find((node) => node.kind === "leaf")!;
