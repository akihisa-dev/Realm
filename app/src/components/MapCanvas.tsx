import { useEffect, useRef } from "react";
import {
  createRealmMapRenderer,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
} from "../map/MapAdapter";
import { Crosshair } from "@phosphor-icons/react/dist/csr/Crosshair";
import { Hand } from "@phosphor-icons/react/dist/csr/Hand";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import type { FeatureType, GeoJsonGeometry, RealmFeature } from "../backend";

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  features?: RealmFeature[];
  mode?: "pan" | FeatureType;
  selectedFeatureId?: string | null;
  onDraw?: (geometry: GeoJsonGeometry) => void;
  onSelect?: (featureId: string | null) => void;
  onModify?: (featureId: string, geometry: GeoJsonGeometry) => void;
  createRenderer?: RealmMapRendererFactory;
};

export function MapCanvas({
  onZoomChange,
  zoom,
  features = [],
  mode = "pan",
  selectedFeatureId = null,
  onDraw,
  onSelect,
  onModify,
  createRenderer = createRealmMapRenderer,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const onZoomChangeRef = useRef(onZoomChange);
  const onDrawRef = useRef(onDraw);
  const onSelectRef = useRef(onSelect);
  const onModifyRef = useRef(onModify);
  const mapHelp = mode === "pan"
    ? "ドラッグまたは矢印キーで移動し、ホイールまたはプラス・マイナスキーで拡大縮小できます。"
    : mode === "city" || mode === "town"
      ? "地図上をクリックして点を配置します。"
      : "地図上でマウスまたはトラックパッドを押したままドラッグし、線または領域を描きます。";

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => { onDrawRef.current = onDraw; }, [onDraw]);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { onModifyRef.current = onModify; }, [onModify]);

  useEffect(() => {
    if (zoom === undefined || !adapterRef.current) return;
    if (Math.abs(adapterRef.current.getZoom() - zoom) > 0.01) adapterRef.current.setZoom(zoom);
  }, [zoom]);

  useEffect(() => { adapterRef.current?.setFeatures(features); }, [features]);
  useEffect(() => { adapterRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { adapterRef.current?.setSelected(selectedFeatureId); }, [selectedFeatureId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const adapter = createRenderer({ target: host });
    adapterRef.current = adapter;
    if (zoom !== undefined && Math.abs(adapter.getZoom() - zoom) > 0.01) adapter.setZoom(zoom);
    const stopZoomListener = adapter.onZoomChange((nextZoom) => onZoomChangeRef.current(nextZoom));
    const stopDrawListener = adapter.onDraw((geometry) => onDrawRef.current?.(geometry));
    const stopSelectListener = adapter.onSelect((featureId) => onSelectRef.current?.(featureId));
    const stopModifyListener = adapter.onModify((featureId, geometry) => onModifyRef.current?.(featureId, geometry));
    adapter.setFeatures(features);
    adapter.setMode(mode);
    adapter.setSelected(selectedFeatureId);
    onZoomChangeRef.current(adapter.getZoom());

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => adapter.updateSize());
    resizeObserver?.observe(host);

    return () => {
      resizeObserver?.disconnect();
      stopZoomListener();
      stopDrawListener();
      stopSelectListener();
      stopModifyListener();
      adapter.dispose();
      adapterRef.current = null;
    };
  }, [createRenderer]);

  return (
    <>
      <p id="map-help" className="sr-only">{mapHelp}</p>
      <div ref={hostRef} className={mode === "pan" ? "map-canvas" : "map-canvas map-canvas-draw"} role="region" tabIndex={0} aria-label="世界地図" aria-describedby="map-help" />
      <div className="map-tools" role="group" aria-label="現在の地図操作">
        <button
          className={mode === "pan" ? "map-tool map-tool-active" : "map-tool"}
          type="button"
          aria-label="地図を移動"
          aria-pressed={mode === "pan"}
          onClick={() => hostRef.current?.focus()}
        >
          <Hand aria-hidden="true" size={22} weight="regular" />
        </button>
        <button className="map-tool" type="button" aria-label="表示を中央に戻す" onClick={() => {
          adapterRef.current?.resetView();
        }}>
          <Crosshair aria-hidden="true" size={21} weight="regular" />
        </button>
      </div>
    </>
  );
}

export function MapZoomControls({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  const percentage = `${Math.round(Math.pow(2, zoom - 1) * 100)}%`;
  return (
    <div className="zoom-controls" role="group" aria-label="地図のズーム">
      <button type="button" aria-label="縮小" onClick={() => onChange(Math.max(0, zoom - 1))} disabled={zoom <= 0}>
        <Minus aria-hidden="true" size={16} weight="regular" />
      </button>
      <span aria-live="polite">{percentage}</span>
      <button type="button" aria-label="拡大" onClick={() => onChange(Math.min(8, zoom + 1))} disabled={zoom >= 8}>
        <Plus aria-hidden="true" size={16} weight="regular" />
      </button>
    </div>
  );
}
