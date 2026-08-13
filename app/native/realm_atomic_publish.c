/*
 * Realm's no-replace publication primitive for macOS.
 *
 * The helper deliberately takes a directory path and two basenames rather
 * than joining paths itself.  It opens and holds the parent directory before
 * checking its identity, then performs every operation relative to that fd.
 * A successful renameatx_np call is the publication point; a later parent
 * fsync failure therefore reports an uncertain durability result while the
 * destination remains published.
 */
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/dir.h>
#include <sys/param.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/stdio.h>
#include <time.h>
#include <unistd.h>

enum {
  REALM_PUBLISH_OK = 0,
  REALM_PUBLISH_ALREADY_EXISTS = 10,
  REALM_PUBLISH_INVALID_PATH = 11,
  REALM_PUBLISH_STORAGE_ERROR = 12,
  REALM_PUBLISH_DURABILITY_UNCERTAIN = 13,
};

static int emit_result(const char *status, int code) {
  /* Status values are constants owned by this executable, so no JSON escaping
     is needed here.  Keeping one stable object on stdout makes execFileSync
     diagnostics deterministic while stderr remains available to developers. */
  (void)fprintf(stdout, "{\"status\":\"%s\"}\n", status);
  (void)fflush(stdout);
  return code;
}

static int invalid_path(const char *message) {
  if (message != NULL) (void)fprintf(stderr, "%s\n", message);
  return emit_result("invalid_path", REALM_PUBLISH_INVALID_PATH);
}

static int storage_error(const char *operation) {
  if (operation != NULL) {
    (void)fprintf(stderr, "%s: %s\n", operation, strerror(errno));
  }
  return emit_result("storage_error", REALM_PUBLISH_STORAGE_ERROR);
}

static int already_exists(void) {
  return emit_result("already_exists", REALM_PUBLISH_ALREADY_EXISTS);
}

static int durability_uncertain(void) {
  return emit_result("published_durability_uncertain", REALM_PUBLISH_DURABILITY_UNCERTAIN);
}

static int parse_uint64(const char *value, uint64_t *result) {
  char *end = NULL;
  unsigned long long parsed;
  if (value == NULL || value[0] == '\0' || value[0] == '-') return 0;
  errno = 0;
  parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0') return 0;
  *result = (uint64_t)parsed;
  return 1;
}

static int is_basename(const char *value) {
  size_t length;
  if (value == NULL || value[0] == '\0') return 0;
  length = strlen(value);
  if (length > NAME_MAX || strcmp(value, ".") == 0 || strcmp(value, "..") == 0) return 0;
  if (strchr(value, '/') != NULL || strchr(value, '\\') != NULL) return 0;
  return 1;
}

static int same_identity(const struct stat *metadata, uint64_t expected_dev, uint64_t expected_ino) {
  return (uint64_t)metadata->st_dev == expected_dev && (uint64_t)metadata->st_ino == expected_ino;
}

static int env_enabled(const char *name) {
  const char *value = getenv(name);
  return value != NULL && value[0] != '\0' && strcmp(value, "0") != 0;
}

static void pause_for_test(const char *name) {
  const char *value = getenv(name);
  char *end = NULL;
  unsigned long milliseconds;
  struct timespec request;
  if (value == NULL || value[0] == '\0') return;
  errno = 0;
  milliseconds = strtoul(value, &end, 10);
  if (errno != 0 || end == value || *end != '\0' || milliseconds == 0) return;
  request.tv_sec = (time_t)(milliseconds / 1000UL);
  request.tv_nsec = (long)((milliseconds % 1000UL) * 1000000UL);
  while (nanosleep(&request, &request) != 0 && errno == EINTR) {
    /* Retry with the remaining interval if a test runner interrupts us. */
  }
}

static int map_open_error(const char *operation) {
  switch (errno) {
    case EACCES:
    case ELOOP:
    case ENAMETOOLONG:
    case ENOENT:
    case ENOTDIR:
      return invalid_path(operation);
    default:
      return storage_error(operation);
  }
}

static int verify_parent_path(const char *parent_path, const struct stat *held_parent, uint64_t expected_dev, uint64_t expected_ino) {
  int path_fd = open(parent_path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  struct stat path_metadata;
  int result;
  if (path_fd < 0) return map_open_error("re-open parent directory");
  if (fstat(path_fd, &path_metadata) != 0) {
    result = storage_error("fstat re-opened parent directory");
    (void)close(path_fd);
    return result;
  }
  (void)close(path_fd);
  if (!S_ISDIR(path_metadata.st_mode) ||
      !same_identity(&path_metadata, expected_dev, expected_ino) ||
      !same_identity(held_parent, expected_dev, expected_ino)) {
    return invalid_path("The parent directory identity changed.");
  }
  return REALM_PUBLISH_OK;
}

static int cleanup_one_owned(int parent_fd, const char *name, uint64_t expected_dev, uint64_t expected_ino) {
  int file_fd;
  struct stat metadata;
  struct stat path_metadata;
  if (expected_dev == 0 || expected_ino == 0) return REALM_PUBLISH_OK;
  file_fd = openat(parent_fd, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (file_fd < 0) {
    if (errno == ENOENT) return REALM_PUBLISH_OK;
    return REALM_PUBLISH_STORAGE_ERROR;
  }
  if (fstat(file_fd, &metadata) != 0) {
    (void)close(file_fd);
    return REALM_PUBLISH_STORAGE_ERROR;
  }
  if (!S_ISREG(metadata.st_mode) || !same_identity(&metadata, expected_dev, expected_ino)) {
    (void)close(file_fd);
    return REALM_PUBLISH_INVALID_PATH;
  }
  if (fstatat(parent_fd, name, &path_metadata, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISREG(path_metadata.st_mode) ||
      !same_identity(&path_metadata, expected_dev, expected_ino)) {
    (void)close(file_fd);
    return REALM_PUBLISH_INVALID_PATH;
  }
  (void)close(file_fd);
  if (unlinkat(parent_fd, name, 0) != 0 && errno != ENOENT) return REALM_PUBLISH_STORAGE_ERROR;
  return REALM_PUBLISH_OK;
}

static int cleanup_staging(int argc, char **argv) {
  int parent_fd = -1;
  struct stat parent_metadata;
  uint64_t expected_parent_dev;
  uint64_t expected_parent_ino;
  uint64_t expected_stage_dev;
  uint64_t expected_stage_ino;
  uint64_t sidecar_dev[3];
  uint64_t sidecar_ino[3];
  static const char *const suffixes[3] = {"-journal", "-wal", "-shm"};
  char sidecar_name[NAME_MAX + 1];
  int result;
  size_t index;

  /* cleanup, parent, staging basename, expected parent dev/ino,
     expected staging dev/ino, then three sidecar dev/ino pairs. */
  if (argc != 14 || !is_basename(argv[3])) return invalid_path("Invalid atomic cleanup arguments.");
  if (!parse_uint64(argv[4], &expected_parent_dev) ||
      !parse_uint64(argv[5], &expected_parent_ino) ||
      !parse_uint64(argv[6], &expected_stage_dev) ||
      !parse_uint64(argv[7], &expected_stage_ino)) return invalid_path("File identities are invalid.");
  for (index = 0; index < 3; index += 1) {
    if (!parse_uint64(argv[8 + index * 2], &sidecar_dev[index]) ||
        !parse_uint64(argv[9 + index * 2], &sidecar_ino[index])) return invalid_path("Sidecar identities are invalid.");
  }
  parent_fd = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parent_fd < 0) {
    if (errno == ENOENT) return emit_result("retained", REALM_PUBLISH_OK);
    return map_open_error("open parent directory for cleanup");
  }
  if (fstat(parent_fd, &parent_metadata) != 0) {
    result = storage_error("fstat parent directory for cleanup");
    (void)close(parent_fd);
    return result;
  }
  if (!S_ISDIR(parent_metadata.st_mode) ||
      !same_identity(&parent_metadata, expected_parent_dev, expected_parent_ino)) {
    (void)close(parent_fd);
    return emit_result("retained", REALM_PUBLISH_OK);
  }
  result = cleanup_one_owned(parent_fd, argv[3], expected_stage_dev, expected_stage_ino);
  if (result == REALM_PUBLISH_INVALID_PATH) {
    (void)close(parent_fd);
    return emit_result("retained", REALM_PUBLISH_OK);
  }
  if (result != REALM_PUBLISH_OK) {
    (void)close(parent_fd);
    return storage_error("cleanup staging file");
  }
  for (index = 0; index < 3; index += 1) {
    if (sidecar_dev[index] == 0 || sidecar_ino[index] == 0) continue;
    if (snprintf(sidecar_name, sizeof(sidecar_name), "%s%s", argv[3], suffixes[index]) < 0 ||
        strlen(argv[3]) + strlen(suffixes[index]) > NAME_MAX) {
      (void)close(parent_fd);
      return invalid_path("The sidecar name is too long.");
    }
    result = cleanup_one_owned(parent_fd, sidecar_name, sidecar_dev[index], sidecar_ino[index]);
    if (result == REALM_PUBLISH_INVALID_PATH) continue;
    if (result != REALM_PUBLISH_OK) {
      (void)close(parent_fd);
      return storage_error("cleanup sidecar");
    }
  }
  (void)close(parent_fd);
  return emit_result("cleaned", REALM_PUBLISH_OK);
}

int main(int argc, char **argv) {
  int parent_fd = -1;
  int staging_fd = -1;
  struct stat parent_metadata;
  struct stat staging_metadata;
  struct stat path_metadata;
  struct stat destination_metadata;
  uint64_t expected_parent_dev;
  uint64_t expected_parent_ino;
  uint64_t expected_staging_dev;
  uint64_t expected_staging_ino;
  int rename_result;

  if (argc > 1 && strcmp(argv[1], "cleanup") == 0) return cleanup_staging(argc, argv);

  /* parent, staging basename, destination basename, expected parent dev/ino,
     expected staging dev/ino. */
  if (argc != 8) return invalid_path("Invalid atomic publication arguments.");
  if (!is_basename(argv[2]) || !is_basename(argv[3])) {
    return invalid_path("Staging and destination names must be basenames.");
  }
  if (!parse_uint64(argv[4], &expected_parent_dev) ||
      !parse_uint64(argv[5], &expected_parent_ino) ||
      !parse_uint64(argv[6], &expected_staging_dev) ||
      !parse_uint64(argv[7], &expected_staging_ino)) {
    return invalid_path("File identities are invalid.");
  }

  parent_fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (parent_fd < 0) return map_open_error("open parent directory");
  if (fstat(parent_fd, &parent_metadata) != 0) {
    int result = storage_error("fstat parent directory");
    (void)close(parent_fd);
    return result;
  }
  if (!S_ISDIR(parent_metadata.st_mode) ||
      !same_identity(&parent_metadata, expected_parent_dev, expected_parent_ino)) {
    (void)close(parent_fd);
    return invalid_path("The parent directory identity changed.");
  }

  /* Test-only pause hooks make replacement races deterministic without
     changing the production protocol. */
  pause_for_test("REALM_ATOMIC_PUBLISH_TEST_PAUSE_AFTER_PARENT_OPEN_MS");
  pause_for_test("REALM_ATOMIC_TEST_PAUSE_AFTER_PARENT_OPEN_MS");

  staging_fd = openat(parent_fd, argv[2], O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
  if (staging_fd < 0) {
    int result = map_open_error("open staging file");
    (void)close(parent_fd);
    return result;
  }
  if (fstat(staging_fd, &staging_metadata) != 0) {
    int result = storage_error("fstat staging file");
    (void)close(staging_fd);
    (void)close(parent_fd);
    return result;
  }
  if (!S_ISREG(staging_metadata.st_mode) ||
      !same_identity(&staging_metadata, expected_staging_dev, expected_staging_ino)) {
    (void)close(staging_fd);
    (void)close(parent_fd);
    return invalid_path("The staging file identity changed.");
  }

  pause_for_test("REALM_ATOMIC_PUBLISH_TEST_PAUSE_AFTER_STAGING_OPEN_MS");
  pause_for_test("REALM_ATOMIC_TEST_PAUSE_AFTER_STAGING_OPEN_MS");
  if (fstatat(parent_fd, argv[2], &path_metadata, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISREG(path_metadata.st_mode) ||
      !same_identity(&path_metadata, expected_staging_dev, expected_staging_ino)) {
    (void)close(staging_fd);
    (void)close(parent_fd);
    return invalid_path("The staging file identity changed.");
  }
  if (fsync(staging_fd) != 0) {
    int result = storage_error("fsync staging file");
    (void)close(staging_fd);
    (void)close(parent_fd);
    return result;
  }

  /* Keep the final path check immediately adjacent to rename.  The optional
     pause is used only by integration tests to replace the pathname in the
     narrow window between fsync and publication. */
  pause_for_test("REALM_ATOMIC_PUBLISH_TEST_PAUSE_BEFORE_RENAME_MS");
  pause_for_test("REALM_ATOMIC_TEST_PAUSE_BEFORE_RENAME_MS");
  {
    int parent_check = verify_parent_path(argv[1], &parent_metadata, expected_parent_dev, expected_parent_ino);
    if (parent_check != REALM_PUBLISH_OK) {
      (void)close(staging_fd);
      (void)close(parent_fd);
      return parent_check;
    }
  }
  if (fstatat(parent_fd, argv[2], &path_metadata, AT_SYMLINK_NOFOLLOW) != 0 ||
      !S_ISREG(path_metadata.st_mode) ||
      !same_identity(&path_metadata, expected_staging_dev, expected_staging_ino)) {
    (void)close(staging_fd);
    (void)close(parent_fd);
    return invalid_path("The staging file identity changed.");
  }

  /* A destination of any kind (including a symlink) is never replaced. */
  if (fstatat(parent_fd, argv[3], &destination_metadata, AT_SYMLINK_NOFOLLOW) == 0) {
    (void)close(staging_fd);
    (void)close(parent_fd);
    return already_exists();
  }
  if (errno != ENOENT) {
    int result = map_open_error("inspect destination");
    (void)close(staging_fd);
    (void)close(parent_fd);
    return result;
  }

  /* renameatx_np(RENAME_EXCL) is the publication point.  Keep staging_fd
     open until after rename so the fsync and identity check cover one inode. */
  rename_result = renameatx_np(parent_fd, argv[2], parent_fd, argv[3], RENAME_EXCL);
  if (rename_result != 0) {
    int result;
    if (errno == EEXIST) result = already_exists();
    else if (errno == EACCES || errno == EINVAL || errno == ELOOP ||
             errno == ENAMETOOLONG || errno == ENOENT || errno == ENOTDIR) {
      result = invalid_path("The atomic publication path is invalid.");
    } else {
      result = storage_error("renameatx_np");
    }
    (void)close(staging_fd);
    (void)close(parent_fd);
    return result;
  }

  (void)close(staging_fd);
  if (env_enabled("REALM_ATOMIC_PUBLISH_FAIL_PARENT_FSYNC") ||
      env_enabled("REALM_ATOMIC_PUBLISH_TEST_FAIL_PARENT_FSYNC") ||
      env_enabled("REALM_ATOMIC_TEST_FAIL_PARENT_FSYNC")) {
    (void)close(parent_fd);
    return durability_uncertain();
  }
  if (fsync(parent_fd) != 0) {
    (void)close(parent_fd);
    return durability_uncertain();
  }
  (void)close(parent_fd);
  return emit_result("published", REALM_PUBLISH_OK);
}
