'use client';

import React, { useCallback, useEffect, useState } from 'react';
import ClusterMap from './ClusterMap';
import CaptureBar from './CaptureBar';
import ParsedChip from './ParsedChip';
import PlaceDetail from './PlaceDetail';
import {
  addPersonToPlace,
  applyDeletes,
  fetchMapPlaces,
  postCapture,
  renamePerson,
  setPlaceTag,
} from '@/lib/api-client';
import type { CaptureResult, MapPlace, PendingDelete, Relationship } from '@/lib/types';

export default function MapHome() {
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Derive the selected place from the latest data so counts stay fresh after a capture.
  const selected = selectedId ? places.find((p) => p.placeId === selectedId) ?? null : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <ClusterMap places={places} selectedPlaceId={selectedId} onSelectPlace={(p) => setSelectedId(p.placeId)} />

      <div className="absolute left-1/2 top-4 z-20 w-[min(680px,92vw)] -translate-x-1/2 space-y-2">
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
    </main>
  );
}
