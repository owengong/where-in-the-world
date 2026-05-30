'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import MapGL, { Marker, NavigationControl, type MapRef } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Supercluster from 'supercluster';
import { CATEGORY_RANK, type MapPlace } from '@/lib/types';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
const RESIDENT_COLOR = '#22c55e'; // green — lives / from / family
const VISITED_COLOR = '#3b82f6'; // blue — visited
const WISHLIST_COLOR = '#eab308'; // yellow — wishlist only

// Highest tier wins for a place or a mixed cluster.
function colorForRank(rank: number): string {
  return rank >= 2 ? RESIDENT_COLOR : rank === 1 ? VISITED_COLOR : WISHLIST_COLOR;
}
// Yellow needs dark text to stay legible; green/blue use white.
function textForRank(rank: number): string {
  return rank === 0 ? '#374151' : '#ffffff';
}

type Props = {
  places: MapPlace[];
  selectedPlaceId?: string | null;
  onSelectPlace: (place: MapPlace) => void;
};

function bubbleSize(count: number): number {
  return Math.min(56, 30 + count * 3);
}

export default function ClusterMap({ places, selectedPlaceId, onSelectPlace }: Props) {
  const mapRef = useRef<MapRef | null>(null);
  const [isGlobe, setIsGlobe] = useState(false);
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [zoom, setZoom] = useState(1.6);

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

  const resetView = useCallback(() => {
    mapRef.current?.flyTo({ center: [0, 20], zoom: 1.6, duration: 800 });
  }, []);

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
        mapStyle="mapbox://styles/mapbox/light-v11"
        projection={{ name: isGlobe ? 'globe' : 'mercator' }}
        onLoad={syncViewport}
        onMoveEnd={syncViewport}
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

      <button
        onClick={resetView}
        title="Zoom out to the full map"
        className="absolute left-4 top-4 z-10 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
      >
        🌍 World
      </button>

      <div className="absolute bottom-4 left-4 flex flex-col items-start gap-2">
        <div className="flex items-center gap-3 rounded-lg bg-white/95 px-3 py-2 text-xs text-gray-600 shadow-md backdrop-blur">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: RESIDENT_COLOR }} />
            lives · from · family
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: VISITED_COLOR }} />
            visited
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border border-white shadow-sm" style={{ backgroundColor: WISHLIST_COLOR }} />
            wishlist
          </span>
        </div>
        <button
          onClick={() => setIsGlobe((g) => !g)}
          className="rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
        >
          {isGlobe ? 'Flat map' : 'Globe'}
        </button>
      </div>
    </div>
  );
}
