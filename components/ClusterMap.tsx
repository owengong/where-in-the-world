'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, { Marker, NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Supercluster from 'supercluster';
import { CATEGORY_RANK, type MapPlace } from '@/lib/types';
import { CATEGORY_COLOR, colorForRank, textForRank } from '@/lib/colors';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

type Props = {
  places: MapPlace[];
  selectedPlaceId?: string | null;
  onSelectPlace: (place: MapPlace) => void;
  /** When set (a fresh object per request), move the map here — fit the bbox if given, else fly to the point. */
  focus?: { lng: number; lat: number; zoom?: number; bbox?: [number, number, number, number] | null } | null;
  /** A USER pan/zoom finished (not a programmatic fly). `zoomedOut` = zoom dropped meaningfully. */
  onUserMove?: (zoomedOut: boolean) => void;
};

function bubbleSize(count: number): number {
  return Math.min(56, 30 + count * 3);
}

export default function ClusterMap({ places, selectedPlaceId, onSelectPlace, focus, onUserMove }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [isGlobe, setIsGlobe] = useState(false);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [zoom, setZoom] = useState(1.6);
  const prevZoomRef = useRef(1.6); // last settled zoom, to tell zoom-out from zoom-in

  const placeById = useMemo(() => {
    const m = new Map<string, MapPlace>();
    for (const p of places) m.set(p.placeId, p);
    return m;
  }, [places]);

  // Supercluster gives the Find-My-style behavior: nearby places collapse into
  // one bubble whose number is the summed person count, and split apart as you
  // zoom in.
  const index = useMemo(() => {
    const sc = new Supercluster({
      radius: 60,
      maxZoom: 16,
      map: (props: any) => ({ personCount: props.personCount, rank: props.rank }),
      reduce: (acc: any, props: any) => {
        acc.personCount += props.personCount;
        acc.rank = Math.max(acc.rank, props.rank);
      },
    });
    sc.load(
      places.map((p) => ({
        type: 'Feature' as const,
        properties: {
          placeId: p.placeId,
          personCount: p.personCount,
          rank: CATEGORY_RANK[p.category],
        },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    );
    return sc;
  }, [places]);

  const clusters = useMemo(() => {
    if (!bounds) return [];
    return index.getClusters(bounds, Math.round(zoom)) as any[];
  }, [index, bounds, zoom]);

  const syncViewport = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    if (b) setBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    setZoom(map.getZoom());
  }, []);

  // Tell a USER pan/zoom (has originalEvent) from a programmatic fly, and whether
  // it zoomed out, so the parent can forget/dismiss the open card on navigation.
  const handleMoveEnd = useCallback(
    (e: any) => {
      syncViewport();
      const z = e?.viewState?.zoom ?? mapRef.current?.getZoom() ?? prevZoomRef.current;
      const zoomedOut = z < prevZoomRef.current - 0.3;
      prevZoomRef.current = z;
      if (e?.originalEvent) onUserMove?.(zoomedOut);
    },
    [syncViewport, onUserMove],
  );

  const resetView = useCallback(() => {
    mapRef.current?.flyTo({ center: [0, 20], zoom: 1.6, duration: 800 });
    onUserMove?.(true); // explicit "zoom out to the whole map" — treat as navigating away
  }, [onUserMove]);

  // Move to a place picked from the palette/list, or a geocoded "go to" search:
  // fit its bounding box when we have one (frames a whole country), else fly.
  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map) return;
    if (focus.bbox) {
      map.fitBounds(
        [
          [focus.bbox[0], focus.bbox[1]],
          [focus.bbox[2], focus.bbox[3]],
        ],
        { padding: 64, duration: 800, maxZoom: 12 },
      );
    } else {
      map.flyTo({ center: [focus.lng, focus.lat], zoom: focus.zoom ?? 10, duration: 800 });
    }
  }, [focus]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-100 p-8 text-center text-sm text-gray-600">
        <div>
          <p className="mb-1 font-medium text-gray-800">No Mapbox token</p>
          <p>
            Add <code className="rounded bg-gray-200 px-1">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code> to{' '}
            <code className="rounded bg-gray-200 px-1">.env</code> to see the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <MapGL
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.6 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/ogong500/cm0ga6nqq011c01pnbth49k9u"
        projection={{ name: isGlobe ? 'globe' : 'mercator' }}
        onLoad={syncViewport}
        onMoveEnd={handleMoveEnd}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {clusters.map((feature) => {
          const [lng, lat] = feature.geometry.coordinates as [number, number];
          const props = feature.properties as any;
          const isCluster = !!props.cluster;
          const count = props.personCount ?? props.point_count ?? 0;
          const rank = props.rank ?? 0;
          const color = colorForRank(rank);
          const textColor = textForRank(rank);
          const size = bubbleSize(count);
          const isSelected = !isCluster && props.placeId === selectedPlaceId;

          const onClick = (e: any) => {
            e?.originalEvent?.stopPropagation?.();
            if (isCluster) {
              const expansionZoom = Math.min(index.getClusterExpansionZoom(props.cluster_id), 16);
              mapRef.current?.easeTo({ center: [lng, lat], zoom: expansionZoom, duration: 500 });
            } else {
              const place = placeById.get(props.placeId);
              if (place) onSelectPlace(place);
            }
          };

          return (
            <Marker
              key={isCluster ? `c-${props.cluster_id}` : `p-${props.placeId}`}
              longitude={lng}
              latitude={lat}
              anchor="center"
              onClick={onClick}
            >
              <div
                className="flex cursor-pointer items-center justify-center rounded-full border-2 border-white font-semibold shadow-md transition-transform hover:scale-110"
                style={{
                  width: size,
                  height: size,
                  backgroundColor: color,
                  color: textColor,
                  fontSize: count >= 100 ? 11 : 13,
                  outline: isSelected ? `3px solid ${color}55` : 'none',
                }}
                title={isCluster ? `${count} people` : placeById.get(props.placeId)?.name}
              >
                {count}
              </div>
            </Marker>
          );
        })}
      </MapGL>

      {/* View controls — a small two-up row under the search bar, same total width. */}
      <div className="absolute left-4 top-16 z-10 flex w-48 gap-2">
        <button
          onClick={resetView}
          title="Zoom out to the full map"
          className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-center text-xs font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
        >
          🔍 Zoom out
        </button>
        <button
          onClick={() => setIsGlobe((g) => !g)}
          className="flex-1 rounded-lg bg-white/95 px-2 py-1.5 text-center text-xs font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
        >
          {isGlobe ? '🗺️ Flat' : '🌐 Globe'}
        </button>
      </div>

      {/* Legend alone, bottom-left. */}
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded-lg bg-white/95 px-3 py-2 text-xs text-gray-600 shadow-md backdrop-blur">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: CATEGORY_COLOR.resident }} />
          lives · from · family
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: CATEGORY_COLOR.visited }} />
          visited
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: CATEGORY_COLOR.wishlist }} />
          wishlist
        </span>
      </div>
    </div>
  );
}
