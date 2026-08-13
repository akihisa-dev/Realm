import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { HookFunction } from "@electron/packager";

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const execPlistBuddy = promisify(execFile) as unknown as PlistBuddyExecutor;

export const forbiddenMacUsageDescriptionKeys = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
] as const;

type PlistBuddyExecutor = (
  file: string,
  args: readonly string[],
  options: { encoding: "utf8" },
) => Promise<{ stdout: string; stderr: string }>;

function errorOutput(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
    return [record.stderr, record.stdout, record.message]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n");
  }
  return String(error);
}

function isMissingEntry(error: unknown, operation: "Print" | "Delete", key: string): boolean {
  return errorOutput(error).includes(`${operation}: Entry, ":${key}", Does Not Exist`);
}

async function printEntry(plistPath: string, key: string, run: PlistBuddyExecutor): Promise<boolean> {
  try {
    await run(PLIST_BUDDY, ["-c", `Print :${key}`, plistPath], { encoding: "utf8" });
    return true;
  } catch (error) {
    if (isMissingEntry(error, "Print", key)) return false;
    throw new Error(`PlistBuddy could not inspect ${key} in ${plistPath}: ${errorOutput(error)}`, { cause: error });
  }
}

export async function sanitizeMacInfoPlist(
  plistPath: string,
  run: PlistBuddyExecutor = execPlistBuddy,
): Promise<void> {
  if (!path.isAbsolute(plistPath)) throw new Error("The packaged Info.plist path must be absolute.");
  for (const key of forbiddenMacUsageDescriptionKeys) {
    if (!await printEntry(plistPath, key, run)) continue;
    try {
      await run(PLIST_BUDDY, ["-c", `Delete :${key}`, plistPath], { encoding: "utf8" });
    } catch (error) {
      // A concurrent packaging step may remove the entry after Print. Re-check
      // it before accepting the Delete failure; all other failures are fatal.
      if (!await printEntry(plistPath, key, run)) continue;
      throw new Error(`PlistBuddy could not remove ${key} from ${plistPath}: ${errorOutput(error)}`, { cause: error });
    }
  }
}

export const sanitizeMacInfoPlistHook: HookFunction = (buildPath, _electronVersion, platform, arch, done) => {
  if (platform !== "darwin" || arch !== "arm64") {
    done();
    return;
  }
  const plistPath = path.join(buildPath, "Realm.app", "Contents", "Info.plist");
  void sanitizeMacInfoPlist(plistPath).then(
    () => done(),
    (error: unknown) => done(error instanceof Error ? error : new Error(String(error))),
  );
};
