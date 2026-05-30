'use client';

import { useCallback, useMemo } from 'react';
import { groupByCountry, searchPlaces, type PlaceGroup, type SearchResult } from '@/lib/search';
import type { MapPlace } from '@/lib/types';

/**
 * One source of truth for searching + grouping, shared by SearchPalette and
 * PlaceList so the two surfaces can never disagree on matching or ordering.
 */
export function useMapSearch(places: MapPlace[]): {
  search: (query: string) => SearchResult[];
  groups: PlaceGroup[];
} {
  const search = useCallback((query: string) => searchPlaces(places, query), [places]);
  const groups = useMemo(() => groupByCountry(places), [places]);
  return { search, groups };
}
