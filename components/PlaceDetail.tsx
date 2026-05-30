'use client';

import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  RELATIONSHIPS,
  RELATIONSHIP_LABEL,
  type MapPlace,
  type PersonLink,
  type Relationship,
} from '@/lib/types';

type Props = {
  place: MapPlace;
  onClose: () => void;
  onAddPerson: (placeId: string, name: string, relationship: Relationship) => void;
  onRemoveLink: (personId: string, linkId: string) => void;
  onRenamePerson: (personId: string, name: string) => void;
  onSetTag: (placeId: string, tag: string, remove: boolean) => void;
  /** Shift left to sit beside the browse drawer when it's open on the right. */
  listOpen?: boolean;
};

export default function PlaceDetail({
  place,
  onClose,
  onAddPerson,
  onRemoveLink,
  onRenamePerson,
  onSetTag,
  listOpen,
}: Props) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('lives');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [tagInput, setTagInput] = useState('');
  const cancelRef = useRef(false); // set synchronously by Escape so onBlur skips the save

  const submitAdd = () => {
    const n = name.trim();
    if (!n) return;
    onAddPerson(place.placeId, n, relationship);
    setName('');
  };

  const startEdit = (p: PersonLink) => {
    setEditingLinkId(p.linkId);
    setDraft(p.name);
  };

  const saveRename = (p: PersonLink) => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setEditingLinkId(null);
      return;
    }
    const n = draft.trim();
    setEditingLinkId(null);
    if (n && n !== p.name) onRenamePerson(p.personId, n);
  };

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
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
          ✕
        </button>
      </div>

      {/* Tags — free-form labels on the place (ski resort, holy site, …). */}
      <div className="px-4 pb-2">
        <div className="flex flex-wrap items-center gap-1">
          {place.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700"
            >
              {tag}
              <button
                onClick={() => onSetTag(place.placeId, tag, true)}
                className="text-indigo-300 hover:text-red-600"
                aria-label={`Remove tag ${tag}`}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const t = tagInput.trim();
                if (t) {
                  onSetTag(place.placeId, t, false);
                  setTagInput('');
                }
              }
            }}
            placeholder="+ tag"
            className="w-24 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs outline-none focus:border-gray-400"
          />
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
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                          } else if (e.key === 'Escape') {
                            cancelRef.current = true;
                            e.currentTarget.blur();
                          }
                        }}
                        onBlur={() => saveRename(p)}
                        className="-my-0.5 min-w-0 flex-1 rounded-md bg-white px-1.5 py-0.5 text-sm text-gray-900 outline-none ring-1 ring-inset ring-gray-300 focus:ring-gray-400"
                      />
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
                      <button
                        onClick={() => onRemoveLink(p.personId, p.linkId)}
                        className="ml-2 shrink-0 text-gray-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                        title={`Remove ${p.name} from ${place.name}`}
                        aria-label={`Remove ${p.name}`}
                      >
                        <X size={14} />
                      </button>
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
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as Relationship)}
            className="rounded-lg border border-gray-200 bg-white px-1.5 py-1.5 text-xs text-gray-700 outline-none focus:border-gray-400"
          >
            {RELATIONSHIPS.map((rel) => (
              <option key={rel} value={rel}>
                {rel}
              </option>
            ))}
          </select>
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
