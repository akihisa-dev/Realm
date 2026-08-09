import { describe, expect, it } from "vitest";
import { parsePrePushUpdates, selectLocalPublicationScript } from "./check-local-publication.mjs";

const zero = "0".repeat(40);

describe("check-local-publication", () => {
  it("selects the branch publication gate", () => {
    const updates = parsePrePushUpdates(`refs/heads/main ${"1".repeat(40)} refs/heads/main ${"2".repeat(40)}\n`);
    expect(selectLocalPublicationScript(updates)).toBe("verify:local:push");
  });

  it("selects the release gate when a tag is included", () => {
    const updates = parsePrePushUpdates([
      `refs/heads/main ${"1".repeat(40)} refs/heads/main ${"2".repeat(40)}`,
      `refs/tags/1.2.3 ${"3".repeat(40)} refs/tags/1.2.3 ${zero}`,
    ].join("\n"));
    expect(selectLocalPublicationScript(updates)).toBe("verify:local:release");
  });

  it("skips the publication gate for deletions only", () => {
    const updates = parsePrePushUpdates(`(delete) ${zero} refs/heads/old ${"2".repeat(40)}\n`);
    expect(selectLocalPublicationScript(updates)).toBeNull();
  });

  it("rejects malformed pre-push input", () => {
    expect(() => parsePrePushUpdates("refs/heads/main only-two-fields")).toThrow("Invalid pre-push update");
  });
});
