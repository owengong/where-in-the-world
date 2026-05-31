'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { List, Search, X } from 'lucide-react';
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
 * Toggleable right drawer that lists every place — visible at ANY zoom, so you
 * never have to zoom in to browse or edit. Default view groups by country; a
 * filter box runs the same search as the palette. Opening it focuses the filter
 * so you can type immediately, and ↑/↓ page a keyboard cursor through the rows
 * (Enter opens). Clicking a row flies the map and opens PlaceDetail (full
 * editing), exactly like a pin click.
 */
export default function PlaceList({ open, onClose, places, selectedPlaceId, onPick }: Props) {
  const { search, groups } = useMapSearch(places);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'people' | 'az'>('people');
  // The keyboard cursor — an index into the flattened, top-to-bottom row order.
  const [active, setActive] = useState(0);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const q = filter.trim();
  const flat = useMemo(() => (q ? search(q) : null), [q, search]);
  const azList = useMemo(
    () => [...places].sort((a, b) => a.name.localeCompare(b.name)),
    [places],
  );
  const grouped = !flat && sort !== 'az';

  // The exact order rows are rendered in — the spine ↑/↓ steps through, so the
  // cursor matches what the eye sees in every mode (filtered / A–Z / grouped).
  const navPlaces = useMemo<MapPlace[]>(() => {
    if (flat) return flat.map((r) => r.place);
    if (sort === 'az') return azList;
    return groups.flatMap((g) => g.places);
  }, [flat, sort, azList, groups]);

  const navIndexById = useMemo(() => {
    const m = new Map<string, number>();
    navPlaces.forEach((p, i) => m.set(p.placeId, i));
    return m;
  }, [navPlaces]);

  // Clamp during render so the cursor never points past the list as it filters
  // down — keeps Enter dispatching to a real row, never a stale index.
  const activeIndex = navPlaces.length ? Math.min(Math.max(active, 0), navPlaces.length - 1) : -1;

  // Scroll a row into view inside the LIST CONTAINER directly — NOT
  // scrollIntoView, which bubbles to the window and scrolls the whole layout to
  // chase an off-screen-right row mid-slide-in (spamming ⌘B made the map bounce).
  const scrollRowIntoView = useCallback(
    (item: HTMLElement | null, center = false) => {
      const container = listRef.current;
      if (!item || !container) return;
      const ir = item.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      if (center) {
        if (ir.top < cr.top || ir.bottom > cr.bottom) {
          container.scrollTop += ir.top - cr.top - (cr.height - ir.height) / 2;
        }
        return;
      }
      const headroom = grouped ? 34 : 8; // clear the sticky country header
      if (ir.top < cr.top + headroom) container.scrollTop += ir.top - cr.top - headroom;
      else if (ir.bottom > cr.bottom) container.scrollTop += ir.bottom - cr.bottom + 8;
    },
    [grouped],
  );

  // When closed, take the off-screen drawer out of the tab order + a11y tree (a
  // CSS translate alone leaves its controls keyboard-focusable). When it opens
  // (⌘B or the Places button), focus the filter so you can type a place straight
  // away — synchronously, AFTER inert is cleared so the field is focusable, and
  // not via rAF (which pauses in background tabs, silently dropping the focus).
  // preventScroll is CRITICAL: the drawer slides in from translate-x-full (fully
  // off-screen right), and a default focus() scrolls the layout to reveal the
  // off-screen input — that was the ⌘B "screen bounce".
  useEffect(() => {
    const drawer = drawerRef.current;
    if (drawer) drawer.inert = !open;
    if (open) inputRef.current?.focus({ preventScroll: true });
  }, [open]);

  // On open, drop the cursor on the place that's already open (if any) so ↑/↓
  // continues from there; otherwise start at the top row.
  useEffect(() => {
    if (!open) return;
    const sel = selectedPlaceId ? navIndexById.get(selectedPlaceId) : undefined;
    setActive(sel ?? 0);
    // Only re-home on OPEN — not when the selection changes mid-browse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-home the cursor to the top whenever the result set reshuffles (typing a
  // filter, or flipping the sort) so Enter lands on the new top match.
  useEffect(() => {
    setActive(0);
  }, [q, sort]);

  // Keep the keyboard cursor visible as it moves.
  useEffect(() => {
    if (open) scrollRowIntoView(activeRef.current);
  }, [activeIndex, open, scrollRowIntoView]);

  // Center the open place when selection changes from a pin/list click.
  useEffect(() => {
    if (open && selectedPlaceId) scrollRowIntoView(selectedRef.current, true);
  }, [selectedPlaceId, open, scrollRowIntoView]);

  // ↑/↓/Home/End page the cursor through the visible rows; Enter opens the
  // cursor's place; Escape stages clear-filter → close. Mounted on the whole
  // drawer (role=dialog) so arrows work no matter what's focused — the filter,
  // a row, OR the Most-people/A–Z toggles. Enter is the only key that defers to
  // a focused control (the sort/close/clear buttons, tagged data-drawer-control)
  // so those keep their native activation. The global Esc handler skips fields,
  // so the drawer owns Escape here.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const last = navPlaces.length - 1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // Functional update + clamp so fast key-repeat accumulates instead of all
      // reading the same pre-render index (which only ever advanced one step).
      setActive((a) => Math.min(Math.min(a, last) + 1, last));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(Math.min(a, last) - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(navPlaces.length - 1);
    } else if (e.key === 'Enter') {
      // A focused control (sort toggle, close, clear-filter) keeps its native Enter.
      if ((e.target as HTMLElement).closest('[data-drawer-control]')) return;
      const place = navPlaces[activeIndex];
      if (place) {
        e.preventDefault();
        onPick(place.placeId);
      }
    } else if (e.key === 'Escape') {
      if (q) {
        e.preventDefault();
        setFilter('');
      } else {
        onClose();
      }
    }
  };

  const row = (place: MapPlace, matched?: string[]) => {
    const idx = navIndexById.get(place.placeId);
    const isActive = idx === activeIndex;
    const isSelected = place.placeId === selectedPlaceId;
    return (
      <ResultRow
        key={place.placeId}
        ref={(el) => {
          if (isActive) activeRef.current = el;
          if (isSelected) selectedRef.current = el;
        }}
        place={place}
        matchedPersonNames={matched}
        active={isActive}
        selected={isSelected}
        onClick={() => {
          if (idx !== undefined) setActive(idx); // cursor follows the click
          onPick(place.placeId);
        }}
      />
    );
  };

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Browse places"
      onKeyDown={handleKeyDown}
      className={`absolute right-0 top-0 z-40 flex h-full w-80 max-w-[85vw] flex-col border-l border-gray-200 bg-white/97 shadow-xl backdrop-blur transition-transform duration-200 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex items-center justify-between px-3 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          <List size={16} /> Places <span className="font-normal text-gray-400">{places.length}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <kbd
            title="Toggle this list with ⌘B"
            className="hidden items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:inline-flex"
          >
            ⌘B
          </kbd>
          <button
            onClick={onClose}
            data-drawer-control
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close list"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2 pt-2">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/70 px-2.5 focus-within:border-gray-400">
          <Search size={15} className="shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter places…"
            aria-label="Filter places"
            className="w-full bg-transparent py-1.5 text-sm outline-none placeholder:text-gray-400"
          />
          {filter && (
            <button
              onClick={() => {
                setFilter('');
                inputRef.current?.focus();
              }}
              data-drawer-control
              aria-label="Clear filter"
              className="shrink-0 text-gray-300 hover:text-gray-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {!q && (
          <div className="mt-2 flex gap-1 text-xs">
            <button
              onClick={() => setSort('people')}
              data-drawer-control
              className={`rounded px-2 py-0.5 ${sort === 'people' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              Most people
            </button>
            <button
              onClick={() => setSort('az')}
              data-drawer-control
              className={`rounded px-2 py-0.5 ${sort === 'az' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              A–Z
            </button>
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-1.5 pb-3">
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
              <div className="sticky top-0 z-10 flex items-baseline gap-1.5 bg-gradient-to-b from-white/90 via-white/75 to-transparent px-2.5 pb-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur-sm">
                <span className="truncate">{g.label}</span>
                <span className="font-normal normal-case tracking-normal text-gray-400">
                  {g.places.length} {g.places.length === 1 ? 'place' : 'places'} · {g.personTotal}{' '}
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
