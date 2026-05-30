'use client';

import React from 'react';
import { RELATIONSHIP_LABEL, type CaptureResult, type PendingDelete } from '@/lib/types';

type Props = {
  result: CaptureResult | null;
  onConfirmDelete: (pending: PendingDelete) => void;
  onCancelDelete: (pending: PendingDelete) => void;
  onDismiss: () => void;
};

const OP_TAG: Record<'add' | 'move', { label: string; cls: string }> = {
  add: { label: 'added', cls: 'bg-emerald-100 text-emerald-700' },
  move: { label: 'moved', cls: 'bg-amber-100 text-amber-700' },
};

export default function ParsedChip({ result, onConfirmDelete, onCancelDelete, onDismiss }: Props) {
  if (!result) return null;
  const { applied, pendingDeletes, issues, usedLLM } = result;
  const empty = applied.length === 0 && pendingDeletes.length === 0 && issues.length === 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Read as</span>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              usedLLM ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-500'
            }`}
            title={usedLLM ? 'Parsed by Claude' : 'Parsed by the built-in quick parser (no API key set)'}
          >
            {usedLLM ? 'Claude' : 'quick parser'}
          </span>
          <button onClick={onDismiss} className="text-gray-400 hover:text-gray-700" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>

      {empty && <p className="text-gray-500">Couldn&apos;t find anything to do — try “Name lives in Place”.</p>}

      {applied.length > 0 && (
        <ul className="space-y-1">
          {applied.map((f, i) => (
            <li key={`a-${i}`} className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${OP_TAG[f.op].cls}`}>
                {OP_TAG[f.op].label}
              </span>
              <span className="font-medium text-gray-900">{f.name}</span>
              <span className="text-gray-400">·</span>
              <span className="text-gray-600">{RELATIONSHIP_LABEL[f.relationship]}</span>
              <span className="font-medium text-gray-900">{f.placeName ?? f.place}</span>
              {f.was && <span className="text-xs text-gray-400">(was {f.was})</span>}
              {!f.geocoded && (
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  not mapped
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {pendingDeletes.length > 0 && (
        <div className={`${applied.length > 0 ? 'mt-2 border-t border-gray-100 pt-2' : ''} space-y-2`}>
          {pendingDeletes.map((p) => (
            <div key={p.token} className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-2.5 py-1.5">
              <span className="text-[13px] text-red-800">{p.label}?</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => onConfirmDelete(p)}
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                >
                  Remove
                </button>
                <button
                  onClick={() => onCancelDelete(p)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:text-gray-800"
                >
                  Keep
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <ul className={`${applied.length > 0 || pendingDeletes.length > 0 ? 'mt-2' : ''} space-y-0.5`}>
          {issues.map((msg, i) => (
            <li key={`i-${i}`} className="text-xs text-gray-400">
              {msg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
