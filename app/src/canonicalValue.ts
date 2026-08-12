/**
 * Deterministic, collision-resistant signatures for renderer state.
 *
 * Realm properties are normally JSON-compatible records, but values can be
 * malformed at a renderer boundary. Every primitive is tagged, plain records
 * sort keys, arrays retain order, and references in a traversal get explicit
 * IDs. Objects outside that small value contract are represented by a weak
 * identity ID instead of being inspected deeply.
 */

const objectIdentityIds = new WeakMap<object, number>();
let nextObjectIdentity = 1;

const identitySignature = (value: object): string => {
  const known = objectIdentityIds.get(value);
  if (known !== undefined) return String(known);
  const assigned = nextObjectIdentity;
  nextObjectIdentity += 1;
  objectIdentityIds.set(value, assigned);
  return String(assigned);
};

const numberSignature = (value: number): string => {
  if (Number.isNaN(value)) return "number:NaN";
  if (value === Number.POSITIVE_INFINITY) return "number:+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "number:-Infinity";
  if (Object.is(value, -0)) return "number:-0";
  return `number:${value.toString()}`;
};

const stringSignature = (value: string): string => {
  let codeUnits = "";
  for (let index = 0; index < value.length; index += 1) codeUnits += value.charCodeAt(index).toString(16).padStart(4, "0");
  return `string:${value.length}:${codeUnits}`;
};

const bytesSignature = (value: ArrayBuffer | ArrayBufferView): string => {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let encoded = "";
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
  return encoded;
};

const constructorName = (value: object): string => {
  try {
    const constructor = Object.getPrototypeOf(value)?.constructor;
    return typeof constructor?.name === "string" && constructor.name.length > 0 ? constructor.name : "Object";
  } catch {
    return "Object";
  }
};

const isPlainRecord = (value: object): boolean => {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
};

/** Returns a stable signature without throwing for renderer-bound values. */
export const canonicalValueSignature = (value: unknown): string => {
  const traversalIds = new WeakMap<object, number>();
  const localSymbolIds = new Map<symbol, number>();
  let nextTraversalId = 1;
  let nextLocalSymbolId = 1;

  const symbolSignature = (symbol: symbol): string => {
    const globalKey = Symbol.keyFor(symbol);
    if (globalKey !== undefined) return `symbol:global:${stringSignature(globalKey)}`;
    const known = localSymbolIds.get(symbol);
    if (known !== undefined) return `symbol:local:${known}`;
    const assigned = nextLocalSymbolId;
    nextLocalSymbolId += 1;
    localSymbolIds.set(symbol, assigned);
    return `symbol:local:${assigned}`;
  };

  const encode = (current: unknown): string => {
    if (current === undefined) return "undefined";
    if (current === null) return "null";
    if (typeof current === "string") return stringSignature(current);
    if (typeof current === "boolean") return `boolean:${current ? "true" : "false"}`;
    if (typeof current === "number") return numberSignature(current);
    if (typeof current === "bigint") return `bigint:${current.toString()}`;
    if (typeof current === "symbol") return symbolSignature(current);
    if (typeof current === "function") return `function:${identitySignature(current as unknown as object)}`;
    if (typeof current !== "object") return `unsupported:${typeof current}`;

    const object = current;
    const previousTraversalId = traversalIds.get(object);
    if (previousTraversalId !== undefined) return `ref:${previousTraversalId}`;

    try {
      if (object instanceof Date) {
        const time = object.getTime();
        return Number.isNaN(time) ? "date:invalid" : `date:${numberSignature(time)}`;
      }
      if (object instanceof ArrayBuffer) return `array-buffer:${bytesSignature(object)}`;
      if (ArrayBuffer.isView(object)) {
        return `typed-array:${constructorName(object)}:${bytesSignature(object)}`;
      }
      if (!Array.isArray(object) && !isPlainRecord(object)) return `unsupported:${constructorName(object)}:${identitySignature(object)}`;

      const traversalId = nextTraversalId;
      nextTraversalId += 1;
      traversalIds.set(object, traversalId);

      if (Array.isArray(object)) {
        const entries: string[] = [];
        for (let index = 0; index < object.length; index += 1) {
          entries.push(Object.prototype.hasOwnProperty.call(object, index) ? encode(object[index]) : "hole");
        }
        const extraKeys = Object.keys(object).filter((key) => {
          if (key === "length") return false;
          const index = Number(key);
          return !Number.isInteger(index) || index < 0 || index >= 4_294_967_295 || String(index) !== key;
        });
        if (extraKeys.length > 0 || Object.getOwnPropertySymbols(object).some((symbol) => Object.prototype.propertyIsEnumerable.call(object, symbol))) {
          return `unsupported:Array:${identitySignature(object)}`;
        }
        return `array#${traversalId}[${entries.join(",")}]`;
      }

      const record = object as Record<string, unknown>;
      if (Object.getOwnPropertySymbols(object).some((symbol) => Object.prototype.propertyIsEnumerable.call(object, symbol))) {
        return `unsupported:Object:${identitySignature(object)}`;
      }
      const keys = Object.keys(record).sort();
      const entries = keys.map((key) => `${stringSignature(key)}=${encode(record[key])}`);
      return `object#${traversalId}{${entries.join(",")}}`;
    } catch {
      return `unsupported:${constructorName(object)}:${identitySignature(object)}`;
    }
  };

  try {
    return encode(value);
  } catch {
    // Proxies and host objects can throw from reflective operations. The
    // fallback is intentionally value-unstable but remains render-safe.
    return `unsupported-root:${typeof value}`;
  }
};
