'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Navigation, Search } from 'lucide-react';
import ResultRow from './ResultRow';
import { searchPlaces } from '@/lib/search';
import type { MapPlace } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: MapPlace[];
  onPick: (placeId: string) => void;
  /** Geocode any place name (even with nobody tagged) and fly the map there. */
  onSearchMap: (query: string) => void;
};

const MAX_RESULTS = 50;

/**
 * Spotlight-style command palette (Cmd/Ctrl+K or "/"). Built on Radix Dialog
 * primitives directly so it can be top-aligned with a light overlay. Picking a
 * tracked place flies + opens PlaceDetail (onPick); the trailing "Go to …" row
 * geocodes ANY place and just frames it on the map (onSearchMap).
 */
export default function SearchPalette({ open, onOpenChange, places, onPick, onSearchMap }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const results = useMemo(() => searchPlaces(places, query).slice(0, MAX_RESULTS), [places, query]);
  const trimmed = query.trim();
  const hasGoto = trimmed.length > 0; // always offer a map jump once you've typed
  const gotoIndex = results.length; // the "Go to …" row sits right after results
  const count = results.length + (hasGoto ? 1 : 0);

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
    setActive((a) => Math.min(a, Math.max(0, count - 1)));
  }, [count]);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (index: number) => {
    if (hasGoto && index === gotoIndex) onSearchMap(trimmed);
    else if (results[index]) onPick(results[index].place.placeId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && hasGoto) onSearchMap(trimmed); // jump to the map from anywhere
      else choose(active);
    }
  };

  const activeId =
    hasGoto && active === gotoIndex
      ? 'palette-goto'
      : results[active]
        ? `palette-opt-${results[active].place.placeId}`
        : undefined;

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
              aria-expanded={count > 0}
              aria-controls="palette-listbox"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
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
            {!query && results.length > 0 && (
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

            {hasGoto && (
              <button
                ref={active === gotoIndex ? activeRef : undefined}
                id="palette-goto"
                role="option"
                aria-selected={active === gotoIndex}
                onClick={() => onSearchMap(trimmed)}
                className={`sticky bottom-0 flex w-full items-center gap-2.5 border-t border-gray-100 px-2.5 py-2.5 text-left transition-colors ${
                  active === gotoIndex ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
                }`}
              >
                <Navigation size={16} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-900">
                    Go to “{trimmed}” on the map
                  </span>
                  <span className="block truncate text-xs text-gray-500">
                    Jump anywhere — even with no one tagged
                  </span>
                </span>
                <kbd className="hidden shrink-0 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-500 sm:block">
                  ⌘↵
                </kbd>
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
