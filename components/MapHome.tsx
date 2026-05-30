'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { List, Search } from 'lucide-react';
import ClusterMap from './ClusterMap';
import CaptureBar from './CaptureBar';
import ParsedChip from './ParsedChip';
import PlaceDetail from './PlaceDetail';
import PlaceList from './PlaceList';
import SearchPalette from './SearchPalette';
import {
  addPersonToPlace,
  applyDeletes,
  fetchMapPlaces,
  postCapture,
  renamePerson,
  setPlaceTag,
} from '@/lib/api-client';
import type { CaptureResult, MapPlace, PendingDelete, Relationship } from '@/lib/types';

type FocusTarget = { lng: number; lat: number; zoom?: number } | null;

// Land past the cluster-expansion threshold so the picked place shows as its own
// pin, scaled to how specific the place is.
function zoomForPlaceType(t: string | null): number {
  switch (t) {
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

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
      setSelectedId(placeId);
      setFocusTarget({ lng: place.lng, lat: place.lat, zoom: zoomForPlaceType(place.placeType) });
      setPaletteOpen(false); // keep the list open so you can edit several in a row
    },
    [places],
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
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === 'l' && !paletteOpen) {
        e.preventDefault();
        setListOpen((o) => !o);
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
        places={places}
        selectedPlaceId={selectedId}
        onSelectPlace={(p) => setSelectedId(p.placeId)}
        focus={focusTarget}
        listOpen={listOpen}
      />

      {!listOpen && (
        <div className="absolute left-4 top-4 z-30 flex items-center gap-2">
          <button
            onClick={() => setPaletteOpen(true)}
            title="Search (⌘/Ctrl+K or /)"
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
          >
            <Search size={16} /> Search
            <kbd className="ml-0.5 hidden rounded border border-gray-200 bg-gray-50 px-1 text-[10px] text-gray-400 sm:inline">
              ⌘K
            </kbd>
          </button>
          <button
            onClick={() => setListOpen(true)}
            title="Browse all places (⌘/Ctrl+L)"
            className="flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-md backdrop-blur hover:bg-white"
          >
            <List size={16} /> Places
          </button>
        </div>
      )}

      <div
        className="absolute top-4 z-20 w-[min(680px,92vw)] -translate-x-1/2 space-y-2"
        style={{ left: listOpen ? 'calc(20rem + (100vw - 20rem) / 2)' : '50%' }}
      >
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
          onDismiss={() => setResult(null)}
        />
      </div>

      {selected && (
        <PlaceDetail
          key={selected.placeId}
          place={selected}
          onClose={() => setSelectedId(null)}
          onAddPerson={handleAddPerson}
          onRemoveLink={handleRemoveLink}
          onRenamePerson={handleRenamePerson}
          onSetTag={handleSetTag}
        />
      )}

      <PlaceList
        open={listOpen}
        onClose={() => setListOpen(false)}
        places={places}
        selectedPlaceId={selectedId}
        onPick={handlePick}
      />

      <SearchPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        places={places}
        onPick={handlePick}
      />
    </main>
  );
}
