import type { MapErrorCode } from "../map/errors";
import messages from "./ja.json";

const MAP_ERROR_MESSAGES: Record<MapErrorCode, string> = messages.mapErrors;
const BACKEND_ERROR_MESSAGES: Readonly<Record<string, string>> = messages.backendErrors;

const japaneseText = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const property = (cause: unknown, key: "code" | "message"): unknown =>
  typeof cause === "object" && cause !== null && key in cause ? Reflect.get(cause, key) : undefined;

export const mapErrorMessage = (code: MapErrorCode, subject: "terrain" | "region" = "terrain"): string =>
  subject === "region" ? "セルの領域属性を更新できませんでした。" : MAP_ERROR_MESSAGES[code];

export const localizedErrorMessage = (cause: unknown, fallback: string): string => {
  const code = property(cause, "code");
  if (typeof code === "string" && BACKEND_ERROR_MESSAGES[code]) return BACKEND_ERROR_MESSAGES[code];
  const message = cause instanceof Error ? cause.message : property(cause, "message");
  return typeof message === "string" && japaneseText.test(message) ? message : fallback;
};
