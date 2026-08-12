import { canonicalValueSignature } from "./canonicalValue";

describe("canonicalValueSignature", () => {
  it("ignores plain-record key order while retaining array order", () => {
    expect(canonicalValueSignature({ alpha: 1, beta: "two" })).toBe(canonicalValueSignature({ beta: "two", alpha: 1 }));
    expect(canonicalValueSignature(["alpha", "beta"])).not.toBe(canonicalValueSignature(["beta", "alpha"]));
  });

  it("distinguishes null, undefined, and special numbers", () => {
    expect(canonicalValueSignature({ value: undefined })).not.toBe(canonicalValueSignature({ value: null }));
    const signatures = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 0].map(canonicalValueSignature);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("represents cycles by traversal references without colliding with marker literals", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalValueSignature(cycle)).not.toThrow();
    expect(canonicalValueSignature(cycle)).toBe(canonicalValueSignature(cycle));
    expect(canonicalValueSignature(cycle)).not.toBe(canonicalValueSignature({ self: "[Circular]" }));
  });

  it("handles BigInt and unsupported values without render-time throws", () => {
    expect(() => canonicalValueSignature({ value: 1n })).not.toThrow();
    expect(canonicalValueSignature({ value: 1n })).not.toBe(canonicalValueSignature({ value: 2n }));

    const first = new Map<string, string>();
    const second = new Map<string, string>();
    expect(() => canonicalValueSignature(first)).not.toThrow();
    expect(canonicalValueSignature(first)).toBe(canonicalValueSignature(first));
    expect(canonicalValueSignature(first)).not.toBe(canonicalValueSignature(second));
  });

  it("encodes supported date and typed-array content", () => {
    expect(canonicalValueSignature(new Date("2025-01-01T00:00:00.000Z"))).toBe(canonicalValueSignature(new Date("2025-01-01T00:00:00.000Z")));
    expect(canonicalValueSignature(new Uint8Array([1, 2]))).not.toBe(canonicalValueSignature(new Uint8Array([1, 3])));
    expect(canonicalValueSignature(new Uint8Array([1, 2]))).not.toBe(canonicalValueSignature(new Uint16Array([513])));
  });
});
