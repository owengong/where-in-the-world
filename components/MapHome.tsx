'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Search, Tag, User, X } from 'lucide-react';
import ClusterMap from './ClusterMap';
import CaptureBar from './CaptureBar';
import ParsedChip from './ParsedChip';
import PlaceDetail from './PlaceDetail';
import PlaceList from './PlaceList';
import SearchPalette from './SearchPalette';
import {
  addPersonToPlace,
  applyDeletes,
  changeLinkRelationship,
  fetchMapPlaces,
  geocodeQuery,
  postCapture,
  renamePerson,
  setPlaceTag,
} from '@/lib/api-client';
import type { CaptureResult, MapPlace, PendingDelete, Relationship } from '@/lib/types';

type FocusTarget = { lng: number; lat: number; zoom?: number; bbox?: [number, number, number, number] | null } | null;

// Land past the cluster-expansion threshold so the picked place shows as its own
// pin, scaled to how specific the place is.
function zoomForPlaceType(t: string | null): number {
  switch (t) {
    case 'continent':
      return 2;
    case 'country':
      return 4;
    case 'region':
      return 6;
    case 'district':
      return 8;
    case 'place':
      return 9;
    case 'locality':
      return 10;
    case 'neighborhood':
      return 12;
    case 'poi':
      return 13;
    default:
      return 9;
  }
}

export default function MapHome() {
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The last place that was open — lets ⌘I reopen it, until you navigate away.
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  // The map can be filtered to ONE person (everywhere they live/visited/want to
  // go). Single-select for now, and mutually exclusive with the tag filter —
  // picking one clears the other (one filter dimension at a time).
  const [personFilter, setPersonFilter] = useState<{ id: string; name: string } | null>(null);

  // The map + browse list show the active filter: a person's places if one is
  // selected, else places carrying ANY selected tag (union), else everything.
  // The palette keeps searching the full set (it's where you pick/clear filters).
  const visiblePlaces = useMemo(() => {
    if (personFilter) return places.filter((p) => p.people.some((l) => l.personId === personFilter.id));
    if (tagFilters.length) return places.filter((p) => p.tags.some((t) => tagFilters.includes(t)));
    return places;
  }, [places, personFilter, tagFilters]);

  // Latest values for the global key handler to read WITHOUT re-subscribing the
  // window listener every render (visiblePlaces is a fresh array each time).
  const lastSelectedIdRef = useRef(lastSelectedId);
  lastSelectedIdRef.current = lastSelectedId;
  const visiblePlacesRef = useRef(visiblePlaces);
  visiblePlacesRef.current = visiblePlaces;

  // Whole tag vocabulary, ranked by how many places carry each — feeds the
  // place panel's add-tag autocomplete so you reuse existing tags, not retype.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of places) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  }, [places]);

  const load = useCallback(async () => {
    try {
      setPlaces(await fetchMapPlaces());
    } catch (e) {
      console.error(e);
      setError('Could not load the map. Is DATABASE_URL set and migrated?');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Remember the most recently opened place so ⌘I can reopen it. Navigating away
  // (a map pan/zoom, below) clears it so the toggle never resurrects a stale card.
  useEffect(() => {
    if (selectedId) setLastSelectedId(selectedId);
  }, [selectedId]);

  // Drop any selected tag that no longer exists on any place (its last tag was
  // removed, or a place dropped out after its last person was removed) so the
  // map can't be stranded empty. Mirrors how `selected` is re-derived below.
  useEffect(() => {
    setTagFilters((cur) => {
      const live = cur.filter((t) => places.some((p) => p.tags.includes(t)));
      return live.length === cur.length ? cur : live;
    });
  }, [places]);

  // Drop the person filter if that person no longer has any places (their last
  // link was removed / they were deleted) so the map can't be stranded empty.
  useEffect(() => {
    setPersonFilter((cur) =>
      cur && places.some((p) => p.people.some((l) => l.personId === cur.id)) ? cur : null,
    );
  }, [places]);

  const handleCapture = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      try {
        const r = await postCapture(text);
        setResult(r);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Capture failed');
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const dropPending = (token: string) =>
    setResult((r) => {
      if (!r) return r;
      const pendingDeletes = r.pendingDeletes.filter((p) => p.token !== token);
      // Once nothing is left to show or confirm, close the chip rather than
      // falling back to the "nothing to do" empty state.
      if (!r.applied.length && !pendingDeletes.length && !r.issues.length) return null;
      return { ...r, pendingDeletes };
    });

  const handleConfirmDelete = useCallback(
    async (pending: PendingDelete) => {
      try {
        await applyDeletes([
          { personId: pending.personId, linkIds: pending.linkIds, deletePerson: pending.deletePerson },
        ]);
        dropPending(pending.token);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Delete failed');
      }
    },
    [load],
  );

  const handleCancelDelete = useCallback((pending: PendingDelete) => dropPending(pending.token), []);

  // Stable so ParsedChip's auto-dismiss timer doesn't reset on every render.
  const handleDismissResult = useCallback(() => setResult(null), []);

  // Direct click-edits from the place panel (no LLM).
  const handleAddPerson = useCallback(
    async (placeId: string, name: string, relationship: Relationship) => {
      try {
        await addPersonToPlace(placeId, name, relationship);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Add failed');
      }
    },
    [load],
  );

  const handleRemoveLink = useCallback(
    async (personId: string, linkId: string) => {
      try {
        await applyDeletes([{ personId, linkIds: [linkId], deletePerson: false }]);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Remove failed');
      }
    },
    [load],
  );

  const handleChangeRelationship = useCallback(
    async (linkId: string, relationship: Relationship) => {
      try {
        await changeLinkRelationship(linkId, relationship);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Move failed');
      }
    },
    [load],
  );

  const handleRenamePerson = useCallback(
    async (personId: string, name: string) => {
      setError(null);
      try {
        await renamePerson(personId, name);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Rename failed');
      }
    },
    [load],
  );

  const handleSetTag = useCallback(
    async (placeId: string, tag: string, remove: boolean) => {
      try {
        await setPlaceTag(placeId, tag, remove);
        await load();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Tag update failed');
      }
    },
    [load],
  );

  // Picking from the palette or the list opens PlaceDetail (same path as a pin
  // click) and flies the map there.
  const handlePick = useCallback(
    (placeId: string) => {
      const place = places.find((p) => p.placeId === placeId);
      if (!place) return;
      // If a filter is active and the picked place isn't in it, clear that filter
      // — otherwise the card would open over an empty map with no pin.
      if (tagFilters.length && !place.tags.some((t) => tagFilters.includes(t))) setTagFilters([]);
      if (personFilter && !place.people.some((l) => l.personId === personFilter.id)) setPersonFilter(null);
      setSelectedId(placeId);
      setFocusTarget({ lng: place.lng, lat: place.lat, zoom: zoomForPlaceType(place.placeType) });
      setPaletteOpen(false); // keep the list open so you can edit several in a row
    },
    [places, tagFilters, personFilter],
  );

  // "Go to <place>" from the palette: geocode ANY place (even with nobody tagged,
  // e.g. "United States") and frame it on the map. No DB write, no PlaceDetail.
  const handleSearchMap = useCallback(async (query: string) => {
    setPaletteOpen(false);
    const hit = await geocodeQuery(query);
    if (!hit) {
      setError(`Couldn't find "${query}" on the map`);
      return;
    }
    setError(null);
    // Navigated to a new location — don't strand an open card (or let ⌘I revive it).
    setSelectedId(null);
    setLastSelectedId(null);
    setFocusTarget({ lng: hit.lng, lat: hit.lat, zoom: zoomForPlaceType(hit.placeType), bbox: hit.bbox });
  }, []);

  // Frame the map to a set of places: fly to a single match, else fit a bbox
  // around them. Also closes a detail panel whose place fell out of the set so it
  // doesn't hang open with no pin. Shared by the tag and person filters.
  const frameMatching = useCallback((matching: MapPlace[]) => {
    setSelectedId((cur) => (cur && !matching.some((p) => p.placeId === cur) ? null : cur));
    if (matching.length === 0) return;
    if (matching.length === 1) {
      const p = matching[0];
      setFocusTarget({ lng: p.lng, lat: p.lat, zoom: zoomForPlaceType(p.placeType) });
      return;
    }
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of matching) {
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
    }
    setFocusTarget({
      lng: (minLng + maxLng) / 2,
      lat: (minLat + maxLat) / 2,
      bbox: [minLng, minLat, maxLng, maxLat],
    });
  }, []);

  const fitToTags = useCallback(
    (tags: string[]) => {
      if (!tags.length) return;
      frameMatching(places.filter((p) => p.tags.some((t) => tags.includes(t))));
    },
    [places, frameMatching],
  );

  // Filter the map (+ browse drawer) to everywhere ONE person is tied to. Clears
  // any tag filter (single dimension), opens the drawer scoped to their places,
  // frames them, and closes the palette — picking a person is a complete action,
  // like picking a place.
  const handleFilterByPerson = useCallback(
    (personId: string, name: string) => {
      setTagFilters([]);
      setPersonFilter({ id: personId, name });
      setListOpen(true);
      setPaletteOpen(false);
      frameMatching(places.filter((p) => p.people.some((l) => l.personId === personId)));
    },
    [places, frameMatching],
  );

  const handleClearPerson = useCallback(() => setPersonFilter(null), []);

  // Toggle a tag in/out of the filter set. Stays in the palette (no close) so you
  // can pick several in a row; re-frames the map to the new union each time.
  const handleToggleTag = useCallback(
    (tag: string) => {
      const adding = !tagFilters.includes(tag);
      const next = adding ? [...tagFilters, tag] : tagFilters.filter((t) => t !== tag);
      setTagFilters(next);
      if (adding) setListOpen(true); // surface the filtered list beside the map
      fitToTags(next);
    },
    [tagFilters, fitToTags],
  );

  const handleClearTags = useCallback(() => setTagFilters([]), []);

  // The user panned/zoomed the map themselves (not a programmatic fly). A zoom-OUT
  // means "navigated away": dismiss the open card and forget the reopen target. A
  // plain pan / zoom-in keeps an OPEN card (so ⌘I still toggles it); only when
  // nothing is open does a pan forget a stale reopen target.
  const handleUserMove = useCallback(
    (zoomedOut: boolean) => {
      if (zoomedOut) {
        setSelectedId(null);
        setLastSelectedId(null);
      } else if (!selectedId) {
        setLastSelectedId(null);
      }
    },
    [selectedId],
  );

  // "Drill into" a tag from a place card: ensure it's in the filter set (never
  // toggles off, so the click always lands you in that tag's view) and frame it.
  const handleFilterByTag = useCallback(
    (tag: string) => {
      const next = tagFilters.includes(tag) ? tagFilters : [...tagFilters, tag];
      setTagFilters(next);
      setListOpen(true); // surface the filtered list beside the map
      fitToTags(next);
    },
    [tagFilters, fitToTags],
  );

  // One global hotkey listener: Cmd/Ctrl+K or "/" => search, Cmd/Ctrl+L => list,
  // Esc closes the next surface down. "/" and Esc never fire while typing.
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      // An open Radix popover (e.g. the relationship menu) owns ALL keys while
      // open — don't let this capture-phase listener hijack Escape/⌘K/⌘B/⌘I and
      // act on the panel/drawer underneath it.
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === 'b' && !paletteOpen) {
        e.preventDefault();
        setListOpen((o) => !o); // toggle the Places sidebar (⌘B doesn't clobber Chrome/Mac)
      } else if (mod && e.key.toLowerCase() === 'i') {
        // Toggle the place detail card. Reopen only if the last place is still
        // valid (exists + not filtered out); navigating away clears that target.
        e.preventDefault();
        if (selectedId) setSelectedId(null);
        else {
          const last = lastSelectedIdRef.current;
          if (last && visiblePlacesRef.current.some((p) => p.placeId === last)) setSelectedId(last);
        }
      } else if (e.key === '/' && !mod && !isEditable(e.target)) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === 'Escape' && !paletteOpen && !isEditable(e.target)) {
        // The palette owns its own Escape; an Escape inside any field stays with
        // that field (e.g. cancel a rename). Otherwise close the next thing down.
        if (listOpen) setListOpen(false);
        else if (selectedId) setSelectedId(null);
      }
    };
    // Capture phase: e.target is still the focused field even for keys that blur
    // it (e.g. Escape in the inline-rename input, which unmounts on blur). In the
    // bubble phase that element is already gone and the isEditable guard misfires.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [paletteOpen, listOpen, selectedId]);

  // Derive the selected place from the latest data so counts stay fresh after a capture.
  const selected = selectedId ? places.find((p) => p.placeId === selectedId) ?? null : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <ClusterMap
        places={visiblePlaces}
        selectedPlaceId={selectedId}
        onSelectPlace={(p) => setSelectedId(p.placeId)}
        focus={focusTarget}
        onUserMove={handleUserMove}
      />

      {/* Search — top-left, the primary action. */}
      <button
        onClick={() => setPaletteOpen(true)}
        title="Search (⌘/Ctrl+K or /)"
        className="absolute left-4 top-4 z-30 flex w-48 items-center justify-between rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
      >
        <span className="flex items-center gap-1.5">
          <Search size={16} /> Search
        </span>
        <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1 text-[10px] text-gray-400 sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Places (browse drawer) — top-right, hidden while the drawer is open. */}
      {!listOpen && (
        <button
          onClick={() => setListOpen(true)}
          title="Browse all places (⌘/Ctrl+B)"
          className="absolute right-4 top-4 z-30 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
        >
          <List size={16} /> Places
          <kbd className="hidden rounded border border-gray-200 bg-gray-50 px-1 text-[10px] text-gray-400 sm:inline">
            ⌘B
          </kbd>
        </button>
      )}

      {/* Active tag filters — under the view controls. 1–3 show as individual
          removable pills (the visual Owen likes); 4+ collapse to one count pill
          that opens the palette, so the left side never gets cluttered. */}
      {(personFilter || tagFilters.length > 0) && (
        <div className="absolute left-4 top-28 z-30 flex max-w-[12rem] flex-col items-start gap-1.5">
          {personFilter ? (
            <span className="flex max-w-full items-center gap-1.5 rounded-lg bg-indigo-100/95 px-2.5 py-1.5 text-xs font-medium text-indigo-900 shadow-md backdrop-blur">
              <User size={13} className="shrink-0" />
              <span className="truncate">{personFilter.name}</span>
              <button
                onClick={handleClearPerson}
                className="-mr-0.5 ml-0.5 shrink-0 rounded p-0.5 hover:bg-indigo-200"
                aria-label={`Clear ${personFilter.name} filter`}
              >
                <X size={13} />
              </button>
            </span>
          ) : tagFilters.length <= 3 ? (
            tagFilters.map((t) => (
              <span
                key={t}
                className="flex max-w-full items-center gap-1.5 rounded-lg bg-amber-100/95 px-2.5 py-1.5 text-xs font-medium text-amber-900 shadow-md backdrop-blur"
              >
                <Tag size={13} className="shrink-0" />
                <span className="truncate">{t}</span>
                <button
                  onClick={() => handleToggleTag(t)}
                  className="-mr-0.5 ml-0.5 shrink-0 rounded p-0.5 hover:bg-amber-200"
                  aria-label={`Remove ${t} filter`}
                >
                  <X size={13} />
                </button>
              </span>
            ))
          ) : (
            <button
              onClick={() => setPaletteOpen(true)}
              title="Manage tag filters"
              className="flex items-center gap-1.5 rounded-lg bg-amber-100/95 px-2.5 py-1.5 text-xs font-medium text-amber-900 shadow-md backdrop-blur hover:bg-amber-200"
            >
              <Tag size={13} className="shrink-0" />
              <span>{tagFilters.length} tags</span>
              <span className="text-amber-600">{visiblePlaces.length}</span>
            </button>
          )}
          {tagFilters.length >= 2 && (
            <button
              onClick={handleClearTags}
              className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium text-gray-600 shadow-md backdrop-blur hover:bg-white"
            >
              Clear all · {visiblePlaces.length} shown
            </button>
          )}
        </div>
      )}

      <div className="absolute left-1/2 top-4 z-20 w-[min(740px,92vw)] -translate-x-1/2 space-y-2">
        <CaptureBar onSubmit={handleCapture} busy={busy} />
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50/95 px-3 py-2 text-sm text-red-700 shadow backdrop-blur">
            {error}
          </div>
        )}
        <ParsedChip
          result={result}
          onConfirmDelete={handleConfirmDelete}
          onCancelDelete={handleCancelDelete}
          onDismiss={handleDismissResult}
        />
      </div>

      {selected && (
        <PlaceDetail
          key={selected.placeId}
          place={selected}
          onClose={() => setSelectedId(null)}
          onAddPerson={handleAddPerson}
          onRemoveLink={handleRemoveLink}
          onChangeRelationship={handleChangeRelationship}
          onRenamePerson={handleRenamePerson}
          onSetTag={handleSetTag}
          onFilterByTag={handleFilterByTag}
          allTags={allTags}
          listOpen={listOpen}
        />
      )}

      <PlaceList
        open={listOpen}
        onClose={() => setListOpen(false)}
        places={visiblePlaces}
        selectedPlaceId={selectedId}
        onPick={handlePick}
      />

      <SearchPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        places={places}
        onPick={handlePick}
        onSearchMap={handleSearchMap}
        tagFilters={tagFilters}
        onToggleTag={handleToggleTag}
        onClearTags={handleClearTags}
        personFilter={personFilter}
        onFilterByPerson={handleFilterByPerson}
        onClearPerson={handleClearPerson}
      />
    </main>
  );
}
