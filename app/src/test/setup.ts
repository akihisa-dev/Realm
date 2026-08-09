import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  class TestResizeObserver implements ResizeObserver {
    observe(): void { /* jsdom has no layout engine. */ }
    unobserve(): void { /* noop */ }
    disconnect(): void { /* noop */ }
  }
  globalThis.ResizeObserver = TestResizeObserver;
}
