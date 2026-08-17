import type { LayerTree, RealmSnapshot, ReplaceLayerTreeInput } from "../../shared/realmContract";
import { validateLayerTree } from "../../shared/layerTree";
import { invalid } from "../domain/errors";
import { captureState } from "../edit/operations";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";
import { transaction } from "../storage/schema";

const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
};

const contentCount = (session: OpenProjectSession, layerId: string): number => {
  const tables = ["terrain_shapes", "regions", "objects"];
  return tables.reduce((total, table) => total + Number((session.database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE layer_id=?`).get(layerId) as { count: number }).count), 0);
};

function prepareTree(input: ReplaceLayerTreeInput): LayerTree {
  assertRecord(input);
  try { return validateLayerTree(input.tree); } catch { throw invalid("レイヤー階層が不正です。"); }
}

export function replaceLayerTree(getSession: () => OpenProjectSession, input: ReplaceLayerTreeInput): RealmSnapshot {
  const session = getSession();
  const tree = prepareTree(input);
  const nextById = new Map(tree.nodes.map((node) => [node.id, node]));
  const existing = session.database.prepare("SELECT id,parent_id AS parentId,kind,name,sort_order AS sortOrder,visible,locked FROM layer_nodes").all() as Record<string, unknown>[];
  for (const node of tree.nodes) {
    if (node.kind === "group" && contentCount(session, node.id) > 0) throw invalid("地物を含むlayerはgroupに変更できません。");
  }
  for (const row of existing) {
    const id = String(row.id);
    if (!nextById.has(id) && contentCount(session, id) > 0) throw invalid("地物を含むlayerは削除できません。");
  }
  const before = captureState(session.database);
  transaction(session.database, () => {
    const temporary = session.database.prepare("UPDATE layer_nodes SET sort_order=? WHERE id=?");
    existing.forEach((row, index) => temporary.run(-1000000 + index, String(row.id)));
    const insert = session.database.prepare("INSERT OR IGNORE INTO layer_nodes(id,parent_id,kind,name,sort_order,visible,locked) VALUES (?,NULL,?,'一時layer',?,?,?)");
    tree.nodes.forEach((node, index) => insert.run(node.id, node.kind, -1000000 + existing.length + index, node.visible ? 1 : 0, node.locked ? 1 : 0));
    const update = session.database.prepare("UPDATE layer_nodes SET parent_id=?,kind=?,name=?,sort_order=?,visible=?,locked=? WHERE id=?");
    for (const node of tree.nodes) update.run(node.parentId, node.kind, node.name, node.order, node.visible ? 1 : 0, node.locked ? 1 : 0, node.id);
    const oldIds = existing.map((row) => String(row.id)).filter((id) => !nextById.has(id));
    const oldParents = new Map(existing.map((row) => [String(row.id), row.parentId === null || row.parentId === undefined ? null : String(row.parentId)]));
    const depthOf = (id: string): number => { let depth = 0; let parent = oldParents.get(id) ?? null; const seen = new Set<string>(); while (parent !== null && !seen.has(parent)) { seen.add(parent); depth += 1; parent = oldParents.get(parent) ?? null; } return depth; };
    oldIds.sort((left, right) => depthOf(right) - depthOf(left));
    const remove = session.database.prepare("DELETE FROM layer_nodes WHERE id=?");
    for (const id of oldIds) remove.run(id);
  });
  session.checkpoint(before, "replace-layer-tree");
  return projectSnapshot(session);
}
