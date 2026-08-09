import { useEffect, useRef } from "react";
import {
  createRealmMapRenderer,
  type RealmMapRenderer,
  type RealmMapRendererFactory,
} from "../map/MapAdapter";

type MapCanvasProps = {
  onZoomChange: (zoom: number) => void;
  zoom?: number;
  createRenderer?: RealmMapRendererFactory;
};

export function MapCanvas({ onZoomChange, zoom, createRenderer = createRealmMapRenderer }: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<RealmMapRenderer | null>(null);
  const onZoomChangeRef = useRef(onZoomChange);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

  useEffect(() => {
    if (zoom === undefined || !adapterRef.current) return;
    if (Math.abs(adapterRef.current.getZoom() - zoom) > 0.01) adapterRef.current.setZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const adapter = createRenderer({ target: host });
    adapterRef.current = adapter;
    if (zoom !== undefined && Math.abs(adapter.getZoom() - zoom) > 0.01) adapter.setZoom(zoom);
    const stopZoomListener = adapter.onZoomChange((nextZoom) => onZoomChangeRef.current(nextZoom));
    onZoomChangeRef.current(adapter.getZoom());

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => adapter.updateSize());
    resizeObserver?.observe(host);

    return () => {
      resizeObserver?.disconnect();
      stopZoomListener();
      adapter.dispose();
      adapterRef.current = null;
    };
  }, [createRenderer]);

  return (
    <>
      <p id="map-help" className="sr-only">ドラッグまたは矢印キーで移動し、ホイールまたはプラス・マイナスキーで拡大縮小できます。</p>
      <div ref={hostRef} className="map-canvas" role="region" tabIndex={0} aria-label="世界地図" aria-describedby="map-help" />
    </>
  );
}

export function MapZoomControls({ zoom, onChange }: { zoom: number; onChange: (zoom: number) => void }) {
  const percentage = `${Math.round(Math.pow(2, zoom - 1) * 100)}%`;
  return (
    <div className="zoom-controls" aria-label="地図のズーム">
      <button type="button" aria-label="縮小" onClick={() => onChange(Math.max(0, zoom - 1))} disabled={zoom <= 0}>
        −
      </button>
      <span aria-live="polite">{percentage}</span>
      <button type="button" aria-label="拡大" onClick={() => onChange(Math.min(8, zoom + 1))} disabled={zoom >= 8}>
        ＋
      </button>
    </div>
  );
}
