import { describe, expect, it, vi } from "vitest";
import { configureDevelopmentUserDataPath } from "./developmentUserData";

describe("configureDevelopmentUserDataPath", () => {
  it("uses an absolute isolated path only for development", () => {
    const app = { setPath: vi.fn() };
    expect(configureDevelopmentUserDataPath(app, "http://127.0.0.1:1420", "/tmp/realm-smoke")).toBe(true);
    expect(app.setPath).toHaveBeenCalledWith("userData", "/tmp/realm-smoke");
    expect(configureDevelopmentUserDataPath(app, undefined, "/tmp/ignored")).toBe(false);
  });

  it("rejects relative paths", () => {
    expect(() => configureDevelopmentUserDataPath({ setPath: vi.fn() }, "http://localhost", "relative")).toThrow("absolute");
  });
});
