import Map from "ol/Map";
import type { MapRaster } from "../exportArtifacts";
import { paintMapTexture } from "./mapTexture";
import { mapTheme, type MapThemeId, type ThemeOverrides } from "./themes";
import type { ExportCanvasSize } from "./contracts";

type Options = {
  map: Map;
  target: HTMLElement;
  worldExtent: readonly number[];
  activeThemeId: MapThemeId;
  themeOverrides: ThemeOverrides;
  selectedObjectIds: readonly string[];
  setSelectedObjects: (objectIds: readonly string[]) => void;
  presentationActive: boolean;
  setPresentationRendering: (preview: boolean) => void;
  mimeType: "image/png" | "image/jpeg";
  requestedScale: number;
  extent: "viewport" | "world";
  size?: ExportCanvasSize | undefined;
};

export async function exportMapRaster(options: Options): Promise<MapRaster> {
  const { map, target, worldExtent, activeThemeId, themeOverrides, selectedObjectIds, setSelectedObjects, presentationActive, setPresentationRendering, mimeType, requestedScale, extent, size } = options;
  const [sourceWidth = 0, sourceHeight = 0] = map.getSize() ?? [];
  const scale = Math.max(1, Math.min(4, Math.round(requestedScale)));
  const baseWidth = size?.width ?? sourceWidth;
  const baseHeight = size?.height ?? sourceHeight;
  const quality = size?.quality ?? 0.92;
  if (!Number.isInteger(baseWidth) || !Number.isInteger(baseHeight) || baseWidth < 1 || baseHeight < 1) throw new Error("書き出しキャンバスの寸法が不正です。");
  if (!Number.isFinite(quality) || quality < 0.5 || quality > 1) throw new Error("書き出し品質は50〜100%で指定してください。");
  if (size && (baseWidth < 512 || baseWidth > 8192 || baseHeight < 512 || baseHeight > 8192)) throw new Error("書き出しキャンバスは512〜8192pxで指定してください。");
  const width = baseWidth * scale;
  const height = baseHeight * scale;
  if (width <= 0 || height <= 0) throw new Error("地図のサイズを取得できません。");
  if (width > 16_384 || height > 16_384 || width * height > 67_108_864) throw new Error("書き出し解像度が大きすぎます。");
  const view = map.getView();
  const originalCenter = view.getCenter()?.slice() as [number, number] | undefined;
  const originalResolution = view.getResolution();
  try {
    if (!presentationActive) setPresentationRendering(true);
    setSelectedObjects([]);
    map.setSize([width, height]);
    if (extent === "world") view.fit([...worldExtent], { size: [width, height], padding: [24 * scale, 24 * scale, 24 * scale, 24 * scale] });
    else {
      if (originalResolution !== undefined) view.setResolution(originalResolution / scale);
      if (originalCenter) view.setCenter(originalCenter);
    }
    map.renderSync();
    const output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    if (!context) throw new Error("地図画像を作成できません。");
    if (mimeType !== "image/png" || size?.transparent !== true) {
      context.fillStyle = mapTheme(activeThemeId, themeOverrides).canvas;
      context.fillRect(0, 0, width, height);
    }
    for (const canvas of target.querySelectorAll<HTMLCanvasElement>("canvas")) {
      if (canvas.width > 0 && canvas.height > 0) context.drawImage(canvas, 0, 0, width, height);
    }
    if (mimeType !== "image/png" || size?.transparent !== true) paintMapTexture(context, width, height, activeThemeId);
    const blob = await new Promise<Blob>((resolve, reject) => {
      output.toBlob((value) => value ? resolve(value) : reject(new Error("地図画像を作成できません。")), mimeType, quality);
    });
    return { bytes: [...new Uint8Array(await blob.arrayBuffer())], width, height };
  } finally {
    map.setSize([sourceWidth, sourceHeight]);
    if (originalResolution !== undefined) view.setResolution(originalResolution);
    if (originalCenter) view.setCenter(originalCenter);
    setSelectedObjects(selectedObjectIds);
    if (!presentationActive) setPresentationRendering(false);
    map.renderSync();
  }
}
