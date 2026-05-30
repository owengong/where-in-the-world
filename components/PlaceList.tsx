'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { List, X } from 'lucide-react';
import ResultRow from './ResultRow';
import { useMapSearch } from './useMapSearch';
import type { MapPlace } from '@/lib/types';

type Props = {
  open: boolean;
  onClose: () => void;
  places: MapPlace[];
  selectedPlaceId: string | null;
  onPick: (placeId: string) => void;
};

/**
 * Toggleable left drawer that lists every place — visible at ANY zoom, so you
 * never have to zoom in to browse or edit. Default view groups by country; a
 * filter box runs the same search as the palette. Clicking a row flies the map
 * and opens PlaceDetail (full editing), exactly like a pin click.
 */
export default function PlaceList({ open, onClose, places, selectedPlaceId, onPick }: Props) {
  const { search, groups } = useMapSearch(places);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'people' | 'az'>('people');
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const q = filter.trim();
  const flat = useMemo(() => (q ? search(q) : null), [q, search]);
  const azList = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name)),
    [places],
  );

  // Scroll the open place into view whenever selection changes (pin OR list).
  useEffect(() => {
    if (open && selectedPlaceId) selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedPlaceId, open]);

  // When closed, take the off-screen drawer out of the tab order + a11y tree
  // (a CSS translate alone leaves its controls keyboard-focusable).
  useEffect(() => {
    if (drawerRef.current) drawerRef.current.inert = !open;
  }, [open]);

  const row = (place: MapPlace, matched?: string[]) => (
    <ResultRow
      key={place.placeId}
      ref={place.placeId === selectedPlaceId ? selectedRef : undefined}
      place={place}
      matchedPersonNames={matched}
      selected={place.placeId === selectedPlaceId}
      onClick={() => onPick(place.placeId)}
    />
  );

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Browse places"
      className={`absolute right-0 top-0 z-40 flex h-full w-80 max-w-[85vw] flex-col border-l border-gray-200 bg-white/97 shadow-xl backdrop-blur transition-transform duration-200 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <List size={16} /> Places <span className="font-normal text-gray-400">{places.length}</span>
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close list">
          <X size={18} />
        </button>
      </div>

      <div className="px-3 pb-2 pt-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter places…"
          className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm outline-none focus:border-gray-400"
        />
        {!q && (
          <div className="mt-2 flex gap-1 text-xs">
            <button
              onClick={() => setSort('people')}
              className={`rounded px-2 py-0.5 ${sort === 'people' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Most people
            </button>
            <button
              onClick={() => setSort('az')}
              className={`rounded px-2 py-0.5 ${sort === 'az' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              A–Z
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
        {flat ? (
          flat.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">No matches</p>
          ) : (
            flat.map((r) => row(r.place, r.matchedPersonNames))
          )
        ) : sort === 'az' ? (
          azList.map((p) => row(p))
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <div className="sticky top-0 z-10 bg-white/95 px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-400 backdrop-blur">
                {g.label}{' '}
                <span className="text-gray-300">
                  · {g.places.length} {g.places.length === 1 ? 'place' : 'places'} · {g.personTotal}{' '}
                  {g.personTotal === 1 ? 'person' : 'people'}
                </span>
              </div>
              {g.places.map((p) => row(p))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
