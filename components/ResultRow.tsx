'use client';

import React from 'react';
import { CATEGORY_COLOR } from '@/lib/colors';
import type { MapPlace } from '@/lib/types';

function subtitle(place: MapPlace): string {
  const where = [place.regionName, place.countryName].filter(Boolean).join(', ');
  const people = `${place.personCount} ${place.personCount === 1 ? 'person' : 'people'}`;
  return where ? `${where} · ${people}` : people;
}

type Props = {
  place: MapPlace;
  matchedPersonNames?: string[];
  active?: boolean; // keyboard-highlighted (palette)
  selected?: boolean; // currently open in PlaceDetail
  onClick: () => void;
  id?: string;
  role?: string; // "option" when used inside the palette's listbox
};

/**
 * Shared row for both the search palette and the browse drawer, so a place reads
 * identically wherever it appears. Pure presentational; forwards a ref so the
 * parent can scroll the active/selected row into view.
 */
const ResultRow = React.forwardRef<HTMLButtonElement, Props>(function ResultRow(
  { place, matchedPersonNames, active, selected, onClick, id, role },
  ref,
) {
  return (
    <button
      ref={ref}
      id={id}
      role={role}
      aria-selected={role === 'option' ? !!active : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
        active ? 'bg-gray-100' : selected ? 'bg-indigo-50' : 'hover:bg-gray-50'
      }`}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: CATEGORY_COLOR[place.category] }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{place.name}</span>
        <span className="block truncate text-xs text-gray-500">{subtitle(place)}</span>
        {matchedPersonNames && matchedPersonNames.length > 0 && (
          <span className="block truncate text-xs text-indigo-600">
            matches: {matchedPersonNames.join(', ')}
          </span>
        )}
      </span>
      {place.tags.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {place.tags.slice(0, 2).map((t) => (
            <span key={t} className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
              {t}
            </span>
          ))}
        </span>
      )}
    </button>
  );
});

export default ResultRow;
