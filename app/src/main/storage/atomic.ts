import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants as fsConstants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { RealmError } from "../domain/errors";
import { ValidatedProject } from "./path";
import { assertSqlitePathNotMoved } from "./schema";

type NativePublishStatus = "published" | "published_durability_uncertain" | "already_exists" | "invalid_path" | "storage_error";
type NativeExecutionFailure = { status?: unknown; stdout?: unknown; stderr?: unknown };
export type ParentIdentity = { dev: number; ino: number };

const NATIVE_EXIT_CODES: Record<number, NativePublishStatus> = {
  0: "published",
  10: "already_exists",
  11: "invalid_path",
  12: "storage_error",
  13: "published_durability_uncertain",
};

function nativeHelperPath(): string {
  const candidates = [
    process.env.REALM_ATOMIC_PUBLISH_HELPER,
    process.resourcesPath && join(process.resourcesPath, "realm_atomic_publish"),
    process.resourcesPath && join(process.resourcesPath, "native", "build", "realm_atomic_publish"),
    resolve(process.cwd(), "native/build/realm_atomic_publish"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const helper = candidates.find((candidate) => existsSync(candidate));
  if (!helper) throw new RealmError("storage_error", "The atomic publication helper is unavailable.");
  return helper;
}


function outputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return "";
}

function parseNativeStatus(output: string): NativePublishStatus | null {
  for (const line of output.trim().split(/\r?\n/u).reverse()) {
    if (!line) continue;
    try {
      const value = JSON.parse(line) as { status?: unknown };
      if (value.status === "published" || value.status === "published_durability_uncertain" || value.status === "already_exists" || value.status === "invalid_path" || value.status === "storage_error") return value.status;
    } catch { /* stderr or an incomplete helper response; exit code remains authoritative. */ }
  }
  return null;
}

function statusFromFailure(failure: NativeExecutionFailure): NativePublishStatus {
  const status = parseNativeStatus(outputText(failure.stdout));
  if (status) return status;
  if (typeof failure.status === "number" && NATIVE_EXIT_CODES[failure.status]) return NATIVE_EXIT_CODES[failure.status]!;
  return "storage_error";
}

function realmErrorForPublish(status: Exclude<NativePublishStatus, "published">): RealmError {
  switch (status) {
    case "already_exists":
      return new RealmError("already_exists", "A project already exists at that path.");
    case "invalid_path":
      return new RealmError("invalid_path", "The staging or destination path changed while publishing.");
    case "published_durability_uncertain":
      return new RealmError("published_durability_uncertain", "The project was published, but folder durability could not be confirmed.");
    default:
      return new RealmError("storage_error", "The project could not be published safely.");
  }
}


function publishWithNativeHelper(parent: string, staging: string, destination: string, parentIdentity: { dev: number; ino: number }, stagingIdentity: { dev: number; ino: number }): NativePublishStatus {
  const args = [
    parent,
    basename(staging),
    basename(destination),
    String(parentIdentity.dev),
    String(parentIdentity.ino),
    String(stagingIdentity.dev),
    String(stagingIdentity.ino),
  ];
  try {
    const output = execFileSync(nativeHelperPath(), args, {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseNativeStatus(outputText(output)) ?? "storage_error";
  } catch (error) {
    return statusFromFailure(error as NativeExecutionFailure);
  }
}

function cleanupWithNativeHelper(parent: string, staging: string, parentIdentity: { dev: number; ino: number }, stagingIdentity: { dev: number; ino: number }, sidecars: Record<string, { dev: number; ino: number } | null>): void {
  const names = ["-journal", "-wal", "-shm"] as const;
  const args = [
    "cleanup",
    parent,
    basename(staging),
    String(parentIdentity.dev),
    String(parentIdentity.ino),
    String(stagingIdentity.dev),
    String(stagingIdentity.ino),
    ...names.flatMap((suffix) => {
      const identity = sidecars[suffix];
      return [String(identity?.dev ?? 0), String(identity?.ino ?? 0)];
    }),
  ];
  try {
    execFileSync(nativeHelperPath(), args, { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    /* Cleanup is deliberately best effort.  The helper has already checked
       parent and inode identities; a mismatch retains the foreign path. */
  }
}

export class AtomicPublisher {
  readonly destination: string;
  readonly staging: string;
  private published = false;
  private stagingFd: number | null = null;
  private readonly identity: ParentIdentity;
  private readonly stagingIdentity: ParentIdentity;
  private readonly sidecars: Record<string, { dev: number; ino: number } | null> = { "-journal": null, "-wal": null, "-shm": null };

  constructor(destination: string, prefix = "realm", expectedParentIdentity?: ParentIdentity) {
    this.destination = destination;
    const parent = dirname(destination);
    mkdirSync(parent, { recursive: true });
    const metadata = lstatSync(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new RealmError("invalid_path", "The destination folder is not a directory.");
    this.identity = { dev: metadata.dev, ino: metadata.ino };
    if (expectedParentIdentity && (metadata.dev !== expectedParentIdentity.dev || metadata.ino !== expectedParentIdentity.ino)) throw new RealmError("invalid_path", "The destination folder changed while publishing.");
    this.staging = join(parent, "." + prefix + "-" + randomUUID() + ".staging");
    this.stagingFd = openSync(this.staging, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600);
    const stagingMetadata = lstatSync(this.staging);
    this.stagingIdentity = { dev: stagingMetadata.dev, ino: stagingMetadata.ino };
  }

  validateStaging(): void {
    const parent = lstatSync(dirname(this.destination));
    const staged = lstatSync(this.staging);
    if (!staged.isFile() || staged.isSymbolicLink() || staged.dev !== this.stagingIdentity.dev || staged.ino !== this.stagingIdentity.ino || parent.dev !== this.identity.dev || parent.ino !== this.identity.ino) throw new RealmError("invalid_path", "The staging path changed while publishing.");
  }

  private rememberSidecars(): void {
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      if (this.sidecars[suffix]) continue;
      try {
        const metadata = lstatSync(this.staging + suffix);
        if (metadata.isFile() && !metadata.isSymbolicLink()) this.sidecars[suffix] = { dev: metadata.dev, ino: metadata.ino };
      } catch { /* absent */ }
    }
  }

  sync(): void {
    this.validateStaging();
    if (this.stagingFd === null) throw new RealmError("storage_error", "The staging file is closed.");
    fsyncSync(this.stagingFd);
    this.rememberSidecars();
  }

  write(bytes: Uint8Array): void {
    if (this.stagingFd === null) throw new RealmError("storage_error", "The staging file is closed.");
    let written = 0;
    while (written < bytes.byteLength) written += writeSync(this.stagingFd, bytes, written, bytes.byteLength - written);
  }

  publish(): void { this.publishWithParentSync(); }

  publishWithParentSyncForTest(syncParent: (directory: string) => void): void { this.publishWithParentSync(syncParent); }

  publishWithParentSync(syncParent?: (directory: string) => void): void {
    this.validateStaging();
    const status = publishWithNativeHelper(dirname(this.destination), this.staging, this.destination, this.identity, this.stagingIdentity);
    if (status === "already_exists" || status === "invalid_path" || status === "storage_error") throw realmErrorForPublish(status);

    /* Both a successful parent fsync and a failed one retain the published
       destination.  Marking ownership before raising is what prevents dispose
       from trying to remove a path that no longer exists (or a foreign file). */
    this.published = true;
    cleanupWithNativeHelper(dirname(this.destination), this.staging, this.identity, this.stagingIdentity, this.sidecars);
    if (status === "published_durability_uncertain") throw realmErrorForPublish(status);
    if (syncParent) {
      try { syncParent(dirname(this.destination)); }
      catch { throw realmErrorForPublish("published_durability_uncertain"); }
    }
  }

  dispose(): void {
    if (this.published) {
      if (this.stagingFd !== null) { closeSync(this.stagingFd); this.stagingFd = null; }
      return;
    }
    let owned = false;
    try {
      const staged = lstatSync(this.staging);
      owned = staged.isFile() && !staged.isSymbolicLink() && staged.dev === this.stagingIdentity.dev && staged.ino === this.stagingIdentity.ino;
    } catch { /* absent */ }
    if (owned) {
      cleanupWithNativeHelper(dirname(this.destination), this.staging, this.identity, this.stagingIdentity, this.sidecars);
    }
    if (this.stagingFd !== null) { closeSync(this.stagingFd); this.stagingFd = null; }
  }
}

export async function copySqliteSnapshot(source: ValidatedProject, destination: string, prefix = "realm-transfer", expectedParentIdentity?: ParentIdentity): Promise<void> {
  source.ensureCurrentIdentity();
  const publisher = new AtomicPublisher(destination, prefix, expectedParentIdentity);
  try {
    assertSqlitePathNotMoved(source.database);
    const result = source.database.prepare("SELECT realm_backup_bytes() AS bytes").get() as { bytes?: unknown };
    if (!(result.bytes instanceof Uint8Array) || result.bytes.length === 0) throw new RealmError("storage_error", "The project snapshot is unavailable.");
    source.ensureCurrentIdentity();
    publisher.write(result.bytes);
    publisher.sync();
    source.ensureCurrentIdentity();
    publisher.validateStaging();
    publisher.publish();
  } finally { publisher.dispose(); }
}

export function copyBytesAtomic(bytes: Uint8Array, destination: string, prefix = "realm-artifact", expectedParentIdentity?: ParentIdentity): void {
  const publisher = new AtomicPublisher(destination, prefix, expectedParentIdentity);
  try {
    publisher.write(bytes);
    publisher.sync();
    publisher.publish();
  } finally { publisher.dispose(); }
}

export function createStagedDatabase(destination: string, prefix = "realm-create", expectedParentIdentity?: ParentIdentity): { publisher: AtomicPublisher; databasePath: string } {
  const publisher = new AtomicPublisher(destination, prefix, expectedParentIdentity);
  return { publisher, databasePath: publisher.staging };
}
