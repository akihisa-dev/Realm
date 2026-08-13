/* Minimal SQLite loadable extension used at every native write/publication boundary.
 * It intentionally uses the extension API rather than linking against a second SQLite. */
#include "vendor/sqlite3ext.h"
SQLITE_EXTENSION_INIT1

static void realm_has_moved(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  (void)argv;
  int moved = 0;
  sqlite3 *db = sqlite3_context_db_handle(context);
  int rc = sqlite3_file_control(db, "main", SQLITE_FCNTL_HAS_MOVED, &moved);
  if (rc != SQLITE_OK || moved != 0) {
    sqlite3_result_error_code(context, SQLITE_IOERR);
    return;
  }
  sqlite3_result_int(context, 0);
}

/* Copy the current source connection through the host SQLite online-backup
 * API into an in-memory destination, then return SQLite's serialized bytes.
 * This keeps the backup on Node's exact SQLite build and never reopens a
 * pathname.  The result is bounded only by the host connection's normal
 * SQLITE_LIMIT_LENGTH contract. */
static void realm_backup_bytes(sqlite3_context *context, int argc, sqlite3_value **argv) {
  sqlite3 *source;
  sqlite3 *destination = 0;
  sqlite3_backup *backup = 0;
  unsigned char *bytes;
  sqlite3_int64 size = 0;
  sqlite3_int64 length_limit;
  int rc;
  (void)argv;
  if (argc != 0) {
    sqlite3_result_error(context, "realm_backup_bytes takes no arguments", -1);
    return;
  }
  source = sqlite3_context_db_handle(context);
  rc = sqlite3_open_v2(":memory:", &destination, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, 0);
  if (rc != SQLITE_OK || destination == 0) {
    if (destination != 0) sqlite3_close(destination);
    sqlite3_result_error_code(context, rc == SQLITE_OK ? SQLITE_CANTOPEN : rc);
    return;
  }
  backup = sqlite3_backup_init(destination, "main", source, "main");
  if (backup == 0) {
    rc = sqlite3_errcode(destination);
    sqlite3_close(destination);
    sqlite3_result_error_code(context, rc);
    return;
  }
  do {
    rc = sqlite3_backup_step(backup, 64);
    if (rc == SQLITE_BUSY || rc == SQLITE_LOCKED) sqlite3_sleep(1);
  } while (rc == SQLITE_OK || rc == SQLITE_BUSY || rc == SQLITE_LOCKED);
  if (rc == SQLITE_DONE) rc = SQLITE_OK;
  {
    int finish_rc = sqlite3_backup_finish(backup);
    if (rc == SQLITE_OK) rc = finish_rc;
  }
  if (rc != SQLITE_OK) {
    sqlite3_close(destination);
    sqlite3_result_error_code(context, rc);
    return;
  }
  /* Normalize the in-memory destination after backup.  Unlike a path-based
     destination this cannot create a journal sidecar, but executing the
     pragma still asks the host SQLite build to emit rollback-format bytes. */
  rc = sqlite3_exec(destination, "PRAGMA journal_mode=DELETE;", 0, 0, 0);
  if (rc != SQLITE_OK) {
    sqlite3_close(destination);
    sqlite3_result_error_code(context, rc);
    return;
  }
  bytes = sqlite3_serialize(destination, "main", &size, 0);
  length_limit = sqlite3_limit(source, SQLITE_LIMIT_LENGTH, -1);
  if (bytes == 0 || size <= 0 || size > length_limit || size > 0x7fffffff) {
    int too_large = size > length_limit || size > 0x7fffffff;
    if (bytes != 0) sqlite3_free(bytes);
    sqlite3_close(destination);
    sqlite3_result_error_code(context, too_large ? SQLITE_TOOBIG : SQLITE_NOMEM);
    return;
  }
  /* Node's deserialize() rejects WAL-format images.  The in-memory backup
     has no journal frames, so these two SQLite file-format bytes are the
     documented rollback-mode header values; normalize them before returning
     the image.  The caller's integrity check/open test covers this boundary. */
  if (size > 19) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  sqlite3_result_blob(context, bytes, (int)size, sqlite3_free);
  sqlite3_close(destination);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_realmhasmoved_init(
    sqlite3 *db, char **error, const sqlite3_api_routines *api) {
  int rc;
  (void)error;
  SQLITE_EXTENSION_INIT2(api);
  rc = sqlite3_create_function(db, "realm_has_moved", 0, SQLITE_UTF8 | SQLITE_DETERMINISTIC,
                               0, realm_has_moved, 0, 0);
  if (rc != SQLITE_OK) return rc;
  rc = sqlite3_create_function(db, "realm_backup_bytes", 0, SQLITE_UTF8,
                               0, realm_backup_bytes, 0, 0);
  return rc;
}
