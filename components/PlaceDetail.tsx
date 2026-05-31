'use client';

import React, { useState } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, Tag, X } from 'lucide-react';
import { normalize } from '@/lib/search';
import {
  RELATIONSHIPS,
  RELATIONSHIP_LABEL,
  type MapPlace,
  type PersonLink,
  type Relationship,
} from '@/lib/types';

/**
 * Relationship picker built on Radix Select so the menu is styled to match the
 * app (not the OS-native dropdown). Both variants show the current label + a
 * caret so it reads as an editable dropdown; the menu is width-matched to the
 * trigger (`--radix-select-trigger-width`) so there's no tiny-icon/wide-menu
 * jump. `compact` is the borderless per-person control (reveals a soft bg on
 * hover/open); `bordered` is the add-person row's boxed control.
 */
function RelationshipSelect({
  value,
  onChange,
  variant = 'compact',
}: {
  value: Relationship;
  onChange: (r: Relationship) => void;
  variant?: 'compact' | 'bordered';
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(v) => onChange(v as Relationship)}>
      <SelectPrimitive.Trigger
        aria-label={`Category: ${RELATIONSHIP_LABEL[value]}. Change`}
        title="Change category"
        className={
          variant === 'bordered'
            ? 'flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 outline-none hover:bg-gray-50 focus:border-gray-400 data-[state=open]:border-gray-400'
            : 'flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-gray-400 outline-none transition hover:bg-gray-100 hover:text-gray-700 focus:bg-gray-100 focus:text-gray-700 data-[state=open]:bg-gray-100 data-[state=open]:text-gray-700'
        }
      >
        <span className="truncate">{RELATIONSHIP_LABEL[value]}</span>
        <ChevronDown size={13} className="shrink-0 text-gray-400" />
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          align="start"
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm text-gray-700 shadow-lg"
        >
          <SelectPrimitive.Viewport>
            {RELATIONSHIPS.map((rel) => (
              <SelectPrimitive.Item
                key={rel}
                value={rel}
                // No checked/selected emphasis — the trigger already shows the
                // current value; only the hovered/keyboard row gets a soft tint.
                className="flex cursor-pointer select-none items-center whitespace-nowrap px-3 py-1.5 outline-none data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900"
              >
                <SelectPrimitive.ItemText>{RELATIONSHIP_LABEL[rel]}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

type Props = {
  place: MapPlace;
  onClose: () => void;
  onAddPerson: (placeId: string, name: string, relationship: Relationship) => void;
  onRemoveLink: (personId: string, linkId: string) => void;
  onChangeRelationship: (linkId: string, relationship: Relationship) => void;
  onRenamePerson: (personId: string, name: string) => void;
  onSetTag: (placeId: string, tag: string, remove: boolean) => void;
  /** Filter the whole map by a tag (clicking a tag chip). */
  onFilterByTag: (tag: string) => void;
  /** Every tag in use across all places — powers the add-tag autocomplete. */
  allTags: string[];
  /** Shift left to sit beside the browse drawer when it's open on the right. */
  listOpen?: boolean;
};

export default function PlaceDetail({
  place,
  onClose,
  onAddPerson,
  onRemoveLink,
  onChangeRelationship,
  onRenamePerson,
  onSetTag,
  onFilterByTag,
  allTags,
  listOpen,
}: Props) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('lives');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tagFocused, setTagFocused] = useState(false);
  const [sugActive, setSugActive] = useState(-1); // -1 = no suggestion highlighted (Enter adds typed)

  const submitAdd = () => {
    const n = name.trim();
    if (!n) return;
    onAddPerson(place.placeId, n, relationship);
    setName('');
  };

  // Add-tag autocomplete: existing tags that match the input and aren't already
  // on this place. Enter with nothing highlighted adds the typed text (reuses an
  // existing tag if the name matches exactly, else creates a new one).
  const tagQ = tagInput.trim();
  const tagMatches = tagQ
    ? allTags.filter((t) => normalize(t).includes(normalize(tagQ)) && !place.tags.includes(t)).slice(0, 8)
    : [];
  const showTagSug = tagFocused && tagMatches.length > 0;

  const addTag = (t: string) => {
    const v = t.trim();
    if (!v) return;
    // Reuse an existing case/diacritic variant already on this place rather than
    // adding a near-duplicate (e.g. "Ski Resort" when it already has "ski resort").
    const dup = place.tags.some((e) => normalize(e) === normalize(v));
    if (!dup) onSetTag(place.placeId, v, false);
    setTagInput('');
    setSugActive(-1);
  };

  const startEdit = (p: PersonLink) => {
    setEditingLinkId(p.linkId);
    setDraft(p.name);
  };

  // Rename commits ONLY on an explicit Enter or the ✓ button. Clicking away
  // (blur) or pressing Escape discards the edit — so a stray keystroke on the
  // select-all'd field can't silently rename someone everywhere on the map.
  const commitRename = (p: PersonLink) => {
    const n = draft.trim();
    setEditingLinkId(null);
    if (n && n !== p.name) onRenamePerson(p.personId, n);
  };
  const cancelRename = () => setEditingLinkId(null);

  return (
    <div
      role="dialog"
      aria-label={place.name}
      className={`absolute top-16 z-30 flex max-h-[calc(100vh-5rem)] w-80 flex-col rounded-2xl border border-gray-200 bg-white/97 shadow-xl backdrop-blur transition-[right] duration-200 ${
        listOpen ? 'right-[21rem]' : 'right-4'
      }`}
    >
      <div className="flex items-start justify-between p-4 pb-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{place.name}</h2>
          <p className="text-xs text-gray-500">
            {place.personCount} {place.personCount === 1 ? 'person' : 'people'}
            {place.placeType ? ` · ${place.placeType}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <kbd
            title="Toggle this card with ⌘I"
            className="hidden items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:inline-flex"
          >
            ⌘I
          </kbd>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close (Esc)">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Tags — click a tag to filter the map by it; ✕ removes it. The input
          searches existing tags (suggestions) and creates a new one on Enter. */}
      <div className="px-4 pb-2">
        {place.tags.length > 0 && (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {place.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 py-0.5 pl-2 pr-1 text-xs text-indigo-700"
              >
                <button
                  onClick={() => onFilterByTag(tag)}
                  className="rounded hover:underline"
                  title={`Filter map by “${tag}”`}
                >
                  {tag}
                </button>
                <button
                  onClick={() => onSetTag(place.placeId, tag, true)}
                  className="text-indigo-300 hover:text-red-600"
                  aria-label={`Remove tag ${tag}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <input
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value);
              setSugActive(-1);
            }}
            onFocus={() => setTagFocused(true)}
            onBlur={() => setTagFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (sugActive >= 0 && tagMatches[sugActive]) addTag(tagMatches[sugActive]);
                else addTag(tagInput);
              } else if (e.key === 'ArrowDown' && showTagSug) {
                e.preventDefault();
                setSugActive((a) => Math.min(a + 1, tagMatches.length - 1));
              } else if (e.key === 'ArrowUp' && showTagSug) {
                e.preventDefault();
                setSugActive((a) => Math.max(a - 1, -1));
              } else if (e.key === 'Escape' && tagInput) {
                e.preventDefault(); // clear the field first; don't close the panel
                setTagInput('');
              }
            }}
            placeholder="+ add or search tags…"
            className="w-full rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-xs outline-none focus:border-gray-400"
          />
          {showTagSug && (
            <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-44 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {tagMatches.map((t, i) => (
                <button
                  key={t}
                  // preventDefault keeps the input focused so this click (not the
                  // input's blur) wins and the suggestion is added.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addTag(t)}
                  className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs ${
                    i === sugActive ? 'bg-indigo-50 text-indigo-800' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <Tag size={11} className="shrink-0 text-gray-400" />
                  <span className="truncate">{t}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 overflow-auto px-4">
        {RELATIONSHIPS.filter((rel) => place.people.some((p) => p.relationship === rel)).map((rel) => (
          <div key={rel}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              {RELATIONSHIP_LABEL[rel]}
            </h3>
            <ul className="space-y-0.5">
              {place.people
                .filter((p) => p.relationship === rel)
                .map((p) => (
                  <li
                    key={p.linkId}
                    className="group flex items-center justify-between rounded-md px-1.5 py-1 transition-colors hover:bg-gray-50"
                  >
                    {editingLinkId === p.linkId ? (
                      <span className="-my-0.5 flex min-w-0 flex-1 items-center gap-1">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(p);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={cancelRename}
                          className="min-w-0 flex-1 rounded-md bg-gray-50 px-1.5 py-0.5 text-sm text-gray-900 outline-none ring-1 ring-inset ring-gray-200 focus:bg-white focus:ring-indigo-300"
                        />
                        {/* preventDefault on mousedown keeps the input focused so its
                            blur (which would discard) never beats this click. */}
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => commitRename(p)}
                          className="shrink-0 rounded p-0.5 text-green-600 hover:bg-green-50"
                          title="Save (Enter)"
                          aria-label="Save name"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={cancelRename}
                          className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title="Cancel (Esc)"
                          aria-label="Cancel rename"
                        >
                          <X size={15} />
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => startEdit(p)}
                        className="min-w-0 flex-1 truncate text-left text-sm text-gray-800"
                        title="Click to rename (updates this person everywhere)"
                      >
                        {p.name}
                      </button>
                    )}
                    {editingLinkId !== p.linkId && (
                      <span className="ml-2 flex shrink-0 items-center gap-0.5">
                        {/* Move this person to another category (faint chevron at
                            rest, opens a styled menu — see RelationshipSelect). */}
                        <RelationshipSelect
                          value={p.relationship}
                          onChange={(rel) => onChangeRelationship(p.linkId, rel)}
                        />
                        <button
                          onClick={() => onRemoveLink(p.personId, p.linkId)}
                          className="text-gray-300 opacity-0 transition-opacity hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                          title={`Remove ${p.name} from ${place.name}`}
                          aria-label={`Remove ${p.name}`}
                        >
                          <X size={14} />
                        </button>
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Add a name directly to this place — no LLM, no re-geocode. */}
      <div className="mt-2 border-t border-gray-100 p-3">
        <div className="flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitAdd();
              }
            }}
            placeholder="Add a name…"
            className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-gray-400"
          />
          <RelationshipSelect variant="bordered" value={relationship} onChange={setRelationship} />
          <button
            onClick={submitAdd}
            disabled={!name.trim()}
            className="rounded-lg bg-gray-900 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
