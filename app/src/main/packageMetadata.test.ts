import { describe, expect, it } from "vitest";

import { forbiddenMacUsageDescriptionKeys, sanitizeMacInfoPlist } from "../../scripts/sanitize-macos-info-plist";

type Invocation = { file: string; args: readonly string[] };

function missingEntry(operation: "Print" | "Delete", key: string): Error & { stderr: string } {
  const error = new Error(`${operation}: Entry, ":${key}", Does Not Exist`) as Error & { stderr: string };
  error.stderr = `${operation}: Entry, ":${key}", Does Not Exist`;
  return error;
}

describe("macOS package metadata sanitizer", () => {
  it("deletes every forbidden permission key without a shell", async () => {
    const calls: Invocation[] = [];
    await sanitizeMacInfoPlist("/tmp/Realm.app/Contents/Info.plist", async (file, args) => {
      calls.push({ file, args });
      return { stdout: "", stderr: "" };
    });
    expect(calls).toHaveLength(forbiddenMacUsageDescriptionKeys.length * 2);
    expect(calls.every(({ file, args }) => file === "/usr/libexec/PlistBuddy" && args[0] === "-c" && args.at(-1) === "/tmp/Realm.app/Contents/Info.plist")).toBe(true);
    expect(calls.filter(({ args }) => String(args[1]).startsWith("Delete "))).toHaveLength(forbiddenMacUsageDescriptionKeys.length);
  });

  it("accepts keys that are absent and rejects unrelated PlistBuddy failures", async () => {
    const absentCalls: Invocation[] = [];
    await sanitizeMacInfoPlist("/tmp/Realm.app/Contents/Info.plist", async (file, args) => {
      absentCalls.push({ file, args });
      throw missingEntry("Print", String(args[1]).slice("Print :".length));
    });
    expect(absentCalls).toHaveLength(forbiddenMacUsageDescriptionKeys.length);

    await expect(sanitizeMacInfoPlist("/tmp/Realm.app/Contents/Info.plist", async () => {
      throw new Error("permission denied");
    })).rejects.toThrow("could not inspect");
  });
});
