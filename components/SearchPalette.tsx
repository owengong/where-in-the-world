'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import ResultRow from './ResultRow';
import { searchPlaces } from '@/lib/search';
import type { MapPlace } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: MapPlace[];
  onPick: (placeId: string) => void;
};

const MAX_RESULTS = 50;

/**
 * Spotlight-style command palette (Cmd/Ctrl+K or "/"). Built on Radix Dialog
 * primitives directly so it can be top-aligned with a light overlay (the shared
 * ui/dialog wrapper hardcodes a centered, dark modal). Editing happens elsewhere
 * — picking a result just flies the map and opens PlaceDetail via onPick.
 */
export default function SearchPalette({ open, onOpenChange, places, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const results = useMemo(() => searchPlaces(places, query).slice(0, MAX_RESULTS), [places, query]);

  // Fresh state every time the palette opens; remember what to refocus on close.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement;
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Keep the highlight in range as results change, and scrolled into view.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) onPick(r.place.placeId);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px]" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Staged Escape: first clear the query, then (on the next press) close.
            if (query) {
              e.preventDefault();
              setQuery('');
            }
          }}
          onCloseAutoFocus={(e) => {
            // Opened from a hotkey (no Dialog.Trigger), so restore focus ourselves.
            e.preventDefault();
            (restoreFocusRef.current as HTMLElement | null)?.focus?.();
          }}
          className="fixed left-1/2 top-[14vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        >
          <Dialog.Title className="sr-only">Search places and people</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-gray-100 px-4">
            <Search size={18} className="shrink-0 text-gray-400" />
            <input
              autoFocus
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="palette-listbox"
              aria-activedescendant={results[active] ? `palette-opt-${results[active].place.placeId}` : undefined}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search places, countries, tags, people…"
              className="w-full bg-transparent py-3.5 text-[15px] outline-none placeholder:text-gray-400"
            />
            <kbd className="hidden shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block">
              esc
            </kbd>
          </div>

          <div
            id="palette-listbox"
            role="listbox"
            aria-label="Search results"
            className="max-h-[60vh] overflow-auto p-1.5"
          >
            {results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">No matches</p>
            ) : (
              <>
                {!query && (
                  <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                    Most connected
                  </p>
                )}
                {results.map((r, i) => (
                  <ResultRow
                    key={r.place.placeId}
                    ref={i === active ? activeRef : undefined}
                    id={`palette-opt-${r.place.placeId}`}
                    role="option"
                    place={r.place}
                    matchedPersonNames={r.matchedPersonNames}
                    active={i === active}
                    onClick={() => onPick(r.place.placeId)}
                  />
                ))}
              </>
            )}
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {query ? `${results.length} result${results.length === 1 ? '' : 's'}` : ''}
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
