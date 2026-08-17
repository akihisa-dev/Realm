import type { LayerTree, RealmSnapshot, ReplaceLayerTreeInput } from "../../shared/realmContract";
import { validateLayerTree } from "../../shared/layerTree";
import { invalid } from "../domain/errors";
import { projectSnapshot } from "../read-model/snapshot";
import type { OpenProjectSession } from "../state/session";

const assertRecord: (input: unknown) => asserts input is Record<string, unknown> = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("The request input is invalid.");
};

function prepareTree(input: ReplaceLayerTreeInput): LayerTree {
  assertRecord(input);
  try { return validateLayerTree(input.tree); } catch { throw invalid("レイヤー階層が不正です。"); }
}

export function replaceLayerTree(getSession: () => OpenProjectSession, input: ReplaceLayerTreeInput): RealmSnapshot {
  const session = getSession();
  const tree = prepareTree(input);
  const nextById = new Map(tree.nodes.map((node) => [node.id, node]));
  const existing = session.store.readLayerNodes();
  for (const node of tree.nodes) {
    if (node.kind === "group" && session.store.contentCount(node.id) > 0) throw invalid("地物を含むlayerはgroupに変更できません。");
  }
  for (const row of existing) {
    if (!nextById.has(row.id) && session.store.contentCount(row.id) > 0) throw invalid("地物を含むlayerは削除できません。");
  }
  session.mutate("replace-layer-tree", (store) => store.replaceLayerTree(tree.nodes.map((node) => ({ id: node.id, parentId: node.parentId, kind: node.kind, name: node.name, sortOrder: node.order, visible: node.visible ? 1 : 0, locked: node.locked ? 1 : 0 }))));
  return projectSnapshot(session);
}
