'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Navigation, Search, Tag, X } from 'lucide-react';
import ResultRow from './ResultRow';
import { normalize, searchPlaces } from '@/lib/search';
import type { MapPlace } from '@/lib/types';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  places: MapPlace[];
  onPick: (placeId: string) => void;
  /** Geocode any place name (even with nobody tagged) and fly the map there. */
  onSearchMap: (query: string) => void;
  /** Tags the map is currently filtered to (union; empty = unfiltered). */
  tagFilters: string[];
  /** Add/remove one tag from the filter set (palette stays open). */
  onToggleTag: (tag: string) => void;
  /** Drop all tag filters. */
  onClearTags: () => void;
};

const MAX_RESULTS = 50;
const MAX_TAG_ROWS = 6; // matching-tag rows shown above results while typing
const CHIP_CAP = 18; // unselected tag chips shown before collapsing to "+N more"

type TagCount = { tag: string; count: number };

// A flat, keyboard-navigable model of everything in the list. Tag rows sit on
// top (while typing), then place results, then the trailing "Go to" row.
type Item =
  | { kind: 'tag'; tag: string; count: number }
  | { kind: 'place'; result: ReturnType<typeof searchPlaces>[number] }
  | { kind: 'goto' };

/**
 * Spotlight-style command palette (Cmd/Ctrl+K or "/"). Built on Radix Dialog
 * primitives directly so it can be top-aligned with a light overlay. Picking a
 * tracked place flies + opens PlaceDetail (onPick); tag rows/chips TOGGLE the
 * map's tag filter (union; onToggleTag) and keep the palette open so you can
 * pick several; the trailing "Go to …" row geocodes ANY place (onSearchMap).
 */
export default function SearchPalette({
  open,
  onOpenChange,
  places,
  onPick,
  onSearchMap,
  tagFilters,
  onToggleTag,
  onClearTags,
}: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  const results = useMemo(() => searchPlaces(places, query).slice(0, MAX_RESULTS), [places, query]);
  const trimmed = query.trim();
  const hasGoto = trimmed.length > 0; // always offer a map jump once you've typed
  const selectedSet = useMemo(() => new Set(tagFilters), [tagFilters]);

  // Distinct tags across every place (full dataset, ignoring the active filter),
  // ranked by how many places carry them.
  const allTags = useMemo<TagCount[]>(() => {
    const counts = new Map<string, number>();
    for (const p of places) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [places]);

  // Unselected tags are the "add" surface (the chip row); selected ones live in
  // the banner. Cap how many chips render so a big tag vocabulary can't flood it.
  const unselectedTags = useMemo(
    () => allTags.filter((t) => !selectedSet.has(t.tag)),
    [allTags, selectedSet],
  );
  const shownChips = unselectedTags.slice(0, CHIP_CAP);
  const hiddenChipCount = unselectedTags.length - shownChips.length;

  // Tags whose name contains the query — these become nav rows while typing.
  const matchingTags = useMemo<TagCount[]>(() => {
    if (!trimmed) return [];
    const nq = normalize(trimmed);
    return allTags.filter((t) => normalize(t.tag).includes(nq)).slice(0, MAX_TAG_ROWS);
  }, [allTags, trimmed]);

  const items = useMemo<Item[]>(() => {
    const tagItems: Item[] = matchingTags.map((t) => ({ kind: 'tag', tag: t.tag, count: t.count }));
    const placeItems: Item[] = results.map((r) => ({ kind: 'place', result: r }));
    const gotoItems: Item[] = hasGoto ? [{ kind: 'goto' }] : [];
    return [...tagItems, ...placeItems, ...gotoItems];
  }, [matchingTags, results, hasGoto]);

  const count = items.length;
  const firstPlaceIndex = matchingTags.length; // where place rows begin

  // Clamp during render so the highlight never points past the list — avoids a
  // transient frame with no active option as results shrink, and keeps Enter
  // dispatching to a real row. This is the source of truth for "what's active".
  const activeIndex = Math.min(active, Math.max(0, count - 1));

  // Fresh state every time the palette opens; remember what to refocus on close.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement;
      setQuery('');
      setActive(0);
    }
  }, [open]);

  // Re-default the highlight to the first PLACE result on every query EDIT (keyed
  // on the text, not the derived tag count) so "type → Enter" lands on the top
  // match even after the user has arrowed around; tag rows above are one ArrowUp.
  useEffect(() => {
    setActive(firstPlaceIndex);
  }, [trimmed, firstPlaceIndex]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const choose = (index: number) => {
    const item = items[index];
    if (!item) return;
    if (item.kind === 'tag') onToggleTag(item.tag); // toggle, palette stays open
    else if (item.kind === 'place') onPick(item.result.place.placeId);
    else onSearchMap(trimmed);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if ((e.metaKey || e.ctrlKey) && hasGoto) onSearchMap(trimmed); // jump to the map from anywhere
      else choose(activeIndex);
    }
  };

  // Index-based option ids keep aria-activedescendant a valid IDREF even for
  // multi-word tags (a tag id with a space wouldn't resolve for screen readers).
  const rowId = (i: number) => `palette-row-${i}`;
  const activeId = items[activeIndex] ? rowId(activeIndex) : undefined;

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
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search places, countries, tags, people…"
              className="w-full bg-transparent py-3.5 text-[15px] outline-none placeholder:text-gray-400"
            />
            <kbd className="hidden shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block">
              esc
            </kbd>
          </div>

          {/* Selected tags — the active filter set (union). Each chip removes
              itself; "Clear all" drops them. Shown in any state so you can manage
              the selection while also typing a place search. */}
          {tagFilters.length > 0 && (
            <div className="border-b border-gray-100 bg-amber-50/60 px-3 py-2">
              <div className="flex items-center justify-between pb-1.5">
                <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-amber-700">
                  Filtering map · {tagFilters.length} {tagFilters.length === 1 ? 'tag' : 'tags'} (any)
                </p>
                <button
                  onClick={onClearTags}
                  className="rounded px-1.5 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  Clear all
                </button>
              </div>
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-auto">
                {tagFilters.map((t) => (
                  <button
                    key={t}
                    onClick={() => onToggleTag(t)}
                    className="flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs text-amber-900 hover:bg-amber-200"
                    aria-label={`Remove ${t} filter`}
                  >
                    <Tag size={11} className="shrink-0" />
                    {t}
                    <X size={12} className="shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Browse-by-tag chips — only on the empty state, and only the tags NOT
              already selected, so tags (otherwise invisible) are discoverable
              without duplicating the banner. Capped so a big vocabulary can't
              flood the UI; type to reach the rest. */}
          {!trimmed && shownChips.length > 0 && (
            <div className="border-b border-gray-100 px-3 py-2.5">
              <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {tagFilters.length ? 'Add another tag' : 'Filter map by tag'}
              </p>
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                {shownChips.map((t) => (
                  <button
                    key={t.tag}
                    onClick={() => onToggleTag(t.tag)}
                    className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <Tag size={11} className="shrink-0 text-gray-400" />
                    {t.tag}
                    <span className="text-gray-400">{t.count}</span>
                  </button>
                ))}
                {hiddenChipCount > 0 && (
                  <span className="self-center px-1 text-xs text-gray-400">
                    +{hiddenChipCount} more — type to find
                  </span>
                )}
              </div>
            </div>
          )}

          <div
            id="palette-listbox"
            role="listbox"
            aria-label="Search results"
            className="max-h-[60vh] overflow-auto p-1.5"
          >
            {!trimmed && results.length > 0 && (
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                Most connected
              </p>
            )}

            {items.map((item, i) => {
              if (item.kind === 'tag') {
                const on = selectedSet.has(item.tag);
                return (
                  <button
                    key={`tag-${item.tag}`}
                    ref={i === activeIndex ? activeRef : undefined}
                    id={rowId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    onClick={() => onToggleTag(item.tag)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      i === activeIndex ? 'bg-amber-50' : on ? 'bg-amber-50/40' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Tag size={16} className="shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-gray-900">
                        {on ? 'Remove' : 'Filter map by'} <span className="font-medium">{item.tag}</span>
                      </span>
                      <span className="block truncate text-xs text-gray-500">
                        {item.count} {item.count === 1 ? 'place' : 'places'}
                        {on ? ' · selected' : ''}
                      </span>
                    </span>
                    {on && <Check size={16} className="shrink-0 text-amber-600" />}
                  </button>
                );
              }
              if (item.kind === 'place') {
                return (
                  <ResultRow
                    key={item.result.place.placeId}
                    ref={i === activeIndex ? activeRef : undefined}
                    id={rowId(i)}
                    role="option"
                    place={item.result.place}
                    matchedPersonNames={item.result.matchedPersonNames}
                    active={i === activeIndex}
                    onClick={() => onPick(item.result.place.placeId)}
                  />
                );
              }
              // goto
              return (
                <button
                  key="goto"
                  ref={i === activeIndex ? activeRef : undefined}
                  id={rowId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  onClick={() => onSearchMap(trimmed)}
                  className={`sticky bottom-0 flex w-full items-center gap-2.5 border-t border-gray-100 px-2.5 py-2.5 text-left transition-colors ${
                    i === activeIndex ? 'bg-gray-100' : 'bg-white hover:bg-gray-50'
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
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
