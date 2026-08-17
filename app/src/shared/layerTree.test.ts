import { describe, expect, it } from "vitest";
import { flattenLayerTree, validateLayerTree } from "./layerTree";

const group = "11111111-1111-4111-8111-111111111111";
const leaf = "22222222-2222-4222-8222-222222222222";

const tree = (overrides: Partial<{ parentId: string | null; visible: boolean; locked: boolean }> = {}) => ({ nodes: [
  { id: group, parentId: null, kind: "group" as const, name: "G", order: 0, visible: true, locked: false },
  { id: leaf, parentId: group, kind: "leaf" as const, name: "L", order: 0, visible: true, locked: false, ...overrides },
] });

describe("layer tree", () => {
  it("flattens deterministically and inherits hidden/locked state", () => {
    const result = flattenLayerTree({ nodes: tree({}).nodes.map((node) => node.id === group ? { ...node, visible: false, locked: true } : node) });
    expect(result.map((node) => node.id)).toEqual([group, leaf]);
    expect(result[1]).toMatchObject({ depth: 1, effectiveVisible: false, effectiveLocked: true, renderOrder: 1 });
  });

  it("rejects cycles, duplicate sibling order, and leaf parents", () => {
    expect(() => validateLayerTree({ nodes: [{ ...tree().nodes[0]!, parentId: leaf }, tree().nodes[1]!] })).toThrow();
    expect(() => validateLayerTree({ nodes: [{ ...tree().nodes[0]!, parentId: null, kind: "leaf" }, { ...tree().nodes[1]!, parentId: null, kind: "leaf", order: 0 }] })).toThrow();
    expect(() => validateLayerTree({ nodes: [{ ...tree().nodes[0]!, kind: "leaf" }, { ...tree().nodes[1]!, parentId: group, order: 0 }] })).toThrow();
  });
});
