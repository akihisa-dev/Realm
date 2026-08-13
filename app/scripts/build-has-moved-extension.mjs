// Compatibility entrypoint retained for scripts and local automation that
// predate the atomic publication helper.  The shared builder now emits both
// native storage tools and keeps the old HAS_MOVED dylib output unchanged.
await import("./build-native-storage-tools.mjs");
