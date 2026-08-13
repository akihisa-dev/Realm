// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { loadDevServerUrlWithRetry } from "./devServerLoader";

describe("dev server loading", () => {
  it("retries transient failures and resolves on the first successful load", async () => {
    vi.useFakeTimers();
    const loadURL = vi.fn().mockRejectedValueOnce(new Error("not ready")).mockRejectedValueOnce(new Error("not ready")).mockResolvedValue(undefined);
    const promise = loadDevServerUrlWithRetry({ loadURL } as never, "http://127.0.0.1:1420");
    const result = expect(promise).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(250);
    await result;
    expect(loadURL).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("fails after all attempts are exhausted", async () => {
    vi.useFakeTimers();
    const loadURL = vi.fn().mockRejectedValue(new Error("offline"));
    const promise = loadDevServerUrlWithRetry({ loadURL } as never, "http://127.0.0.1:1420");
    const failure = expect(promise).rejects.toThrow("not reachable");
    await vi.advanceTimersByTimeAsync(2_100);
    await failure;
    expect(loadURL).toHaveBeenCalledTimes(20);
    vi.useRealTimers();
  });
});
