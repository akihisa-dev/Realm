export class RealmError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "RealmError";
    this.code = code;
    this.details = details;
  }
}

export const invalid = (message: string): RealmError => new RealmError("invalid_input", message);
export const corrupt = (message = "The project schema is corrupt."): RealmError => new RealmError("corrupt_project", message);

export function asRealmError(error: unknown, fallback = "The Realm operation failed."): RealmError {
  if (error instanceof RealmError) return error;
  if (error instanceof Error) return new RealmError("storage_error", error.message);
  return new RealmError("storage_error", fallback);
}
