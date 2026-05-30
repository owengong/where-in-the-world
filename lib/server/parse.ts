import Anthropic from '@anthropic-ai/sdk';
import {
  RELATIONSHIPS,
  CAPTURE_OPS,
  isRelationship,
  isCaptureOp,
  type ParsedOp,
  type Relationship,
  type CaptureOp,
} from '@/lib/types';

// Text-in / structure-out. Given free-form text, return operations:
//   add    — record a new person↔place↔relationship link
//   move   — the person's lives/from/family is now this place (replaces the old)
//   remove — delete a link, or the whole person
// Uses Claude Haiku 4.5 with a forced tool call. With no ANTHROPIC_API_KEY, a
// built-in heuristic parser is used so the app stays runnable offline.

const MODEL = 'claude-haiku-4-5';

const SYSTEM = `You turn short, informal notes about a person's friends into structured operations on a map database.

For each person↔place connection (or change) in the text, emit one entry via the record_operations tool. One sentence can produce several entries (e.g. "Berlin: Mira, Kai, Noor" = three add entries).

Each entry has an "op":
- "add" (DEFAULT): record a new connection. Use for almost everything, including all visited/wishlist mentions (those are cumulative — a person can visit many places).
- "move": the person's CURRENT lives/from/family for a place has changed — replace the old one. Use ONLY for lives/from/family when the wording implies relocation or change: "moved to", "now lives in", "relocated to", "is now based in", "no longer in X, now in Y". Never use move for visited/wishlist.
- "remove": delete something. Use for "remove", "delete", "no longer ...", "isn't ... anymore", "drop". If a specific place is named, set place to it (removes that connection). If NO place is named (e.g. "remove Ada", "delete Theo"), set place to "" (removes the whole person).

relationship is one of: lives, from, family, visited, wishlist. Cues:
- lives: lives in, based in, moved to, is in, now in
- from: from, grew up in, originally from, hometown
- family: family in, parents in
- visited: met/saw X in Y, visited, went to, was in
- wishlist: wants to go to, would love to visit, bucket list
For a "remove" with no clear relationship, just use "lives" (it's ignored for removals).

place: keep close to what's written (city, neighborhood, US state, country, or national park), but expand obvious abbreviations ("NYC" -> "New York City"). For a whole-person removal, place is "".

confidence: 0-1 for how sure you are about the entry.

Examples:
- "Ada lives in Lisbon" -> [{op:"add", name:"Ada", place:"Lisbon", relationship:"lives", confidence:0.95}]
- "Lena, Hugo and Wren all live in Chicago" -> three add entries, each relationship:"lives", place:"Chicago"
- "Ada moved to Berlin" -> [{op:"move", name:"Ada", place:"Berlin", relationship:"lives", confidence:0.95}]
- "Theo's family moved to Rome" -> [{op:"move", name:"Theo", place:"Rome", relationship:"family", confidence:0.9}]
- "met Theo in Tokyo" -> [{op:"add", name:"Theo", place:"Tokyo", relationship:"visited", confidence:0.9}]
- "Ada doesn't live in Brooklyn anymore" -> [{op:"remove", name:"Ada", place:"Brooklyn", relationship:"lives", confidence:0.9}]
- "remove Remy" -> [{op:"remove", name:"Remy", place:"", relationship:"lives", confidence:0.95}]
- "actually Theo is from Berlin not Munich" -> [{op:"move", name:"Theo", place:"Berlin", relationship:"from", confidence:0.9}]

Only output via the tool. If you find nothing actionable, return an empty array.`;

const TOOL: Anthropic.Tool = {
  name: 'record_operations',
  description: 'Record every add/move/remove operation found in the text.',
  input_schema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            op: { type: 'string', enum: [...CAPTURE_OPS], description: 'add | move | remove' },
            name: { type: 'string', description: 'the person' },
            place: {
              type: 'string',
              description: 'place roughly as written; "" only for removing a whole person',
            },
            relationship: { type: 'string', enum: [...RELATIONSHIPS] },
            confidence: { type: 'number', description: '0-1' },
          },
          required: ['op', 'name', 'place', 'relationship', 'confidence'],
        },
      },
    },
    required: ['operations'],
  },
};

export type ParseOutput = {
  ops: ParsedOp[];
  usedLLM: boolean;
  modelId: string | null;
};

function sanitize(raw: unknown): ParsedOp[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedOp[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const name = String((r as any).name ?? '').trim();
    if (!name) continue;
    const op: CaptureOp = isCaptureOp((r as any).op) ? (r as any).op : 'add';
    const place = String((r as any).place ?? '').trim();
    // add/move require a place; only remove may omit it.
    if (op !== 'remove' && !place) continue;
    const relationship: Relationship = isRelationship((r as any).relationship)
      ? (r as any).relationship
      : 'lives';
    let c = Number((r as any).confidence);
    if (!Number.isFinite(c)) c = 0.5;
    c = Math.max(0, Math.min(1, c));
    out.push({ op, name, place, relationship, confidence: c });
  }
  return out;
}

export async function parseCapture(text: string): Promise<ParseOutput> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ops: stubParse(text), usedLLM: false, modelId: null };
  }

  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_operations' },
      messages: [{ role: 'user', content: text }],
    });

    const block = msg.content.find((b) => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      return { ops: stubParse(text), usedLLM: false, modelId: null };
    }
    const ops = sanitize((block.input as any)?.operations);
    return { ops, usedLLM: true, modelId: MODEL };
  } catch (e) {
    console.error('[parse] LLM error, falling back to quick parser:', e);
    return { ops: stubParse(text), usedLLM: false, modelId: null };
  }
}

// --- Built-in heuristic fallback (no API key) ---------------------------------
// Best-effort only; the real extraction is the LLM path above.

function cleanName(s: string): string {
  return s.replace(/^(and|with|&)\s+/i, '').replace(/[.,;:]+$/, '').trim();
}

function splitNames(s: string): string[] {
  return s
    .split(/,|&|\band\b/i)
    .map((x) => cleanName(x))
    .filter(Boolean);
}

const REL_PATTERNS: { re: RegExp; rel: Relationship; op: CaptureOp }[] = [
  // removals first
  { re: /^(?:remove|delete|drop)\s+(.+?)\s+from\s+(.+)$/i, rel: 'lives', op: 'remove' },
  { re: /(.+?)\s+(?:doesn'?t live in|no longer (?:lives? in|in)|isn'?t in)\s+(.+)/i, rel: 'lives', op: 'remove' },
  // moves
  { re: /(.+?)\s+(?:moved to|relocated to|now lives? in|is now in|is now based in)\s+(.+)/i, rel: 'lives', op: 'move' },
  { re: /(.+?)\s+family (?:moved to|now in)\s+(.+)/i, rel: 'family', op: 'move' },
  // adds
  { re: /\b(?:met|saw|ran into|visited|hung out with)\s+(.+?)\s+in\s+(.+)/i, rel: 'visited', op: 'add' },
  { re: /(.+?)\s+(?:has\s+)?family\s+(?:in|lives in)\s+(.+)/i, rel: 'family', op: 'add' },
  { re: /(.+?)\s+(?:wants to (?:go|visit)|would love to (?:go|visit)|dreams? of(?: visiting)?)\s+(?:to\s+)?(.+)/i, rel: 'wishlist', op: 'add' },
  { re: /(.+?)\s+is\s+from\s+(.+)/i, rel: 'from', op: 'add' },
  { re: /(.+?)\s+(?:grew up in|originally from|hometown is)\s+(.+)/i, rel: 'from', op: 'add' },
  { re: /(.+?)\s+(?:lives?|living|based)\s+(?:in\s+)?(.+)/i, rel: 'lives', op: 'add' },
];

function stubParse(text: string): ParsedOp[] {
  const out: ParsedOp[] = [];
  const lines = text
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // "remove/delete Name" with no place -> remove whole person
    const removePerson = line.match(/^(?:remove|delete)\s+(.+)$/i);
    if (removePerson && !/\b(from|in)\b/i.test(removePerson[1])) {
      for (const name of splitNames(removePerson[1]))
        out.push({ op: 'remove', name, place: '', relationship: 'lives', confidence: 0.5 });
      continue;
    }

    // "Place: Name, Name" -> add lives
    const colon = line.match(/^([^:]+):\s*(.+)$/);
    if (colon && !/https?/i.test(colon[1])) {
      const place = colon[1].trim();
      for (const name of splitNames(colon[2]))
        out.push({ op: 'add', name, place, relationship: 'lives', confidence: 0.4 });
      continue;
    }

    let matched = false;
    for (const { re, rel, op } of REL_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const place = cleanName(m[2]);
        for (const name of splitNames(m[1])) out.push({ op, name, place, relationship: rel, confidence: 0.45 });
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // "Name - Place" -> add lives
    const dash = line.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (dash) {
      const place = cleanName(dash[2]);
      for (const name of splitNames(dash[1]))
        out.push({ op: 'add', name, place, relationship: 'lives', confidence: 0.3 });
    }
  }
  return out;
}
