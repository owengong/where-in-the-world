# Where in the World

A personal map of the people and places in your life. The map is the home
screen (Find-My style — pins collapse into per-region counts as you zoom out),
and you capture by **typing free text** — *"Ada lives in Lisbon"*,
*"met Theo in Tokyo"*, *"Berlin: Mira, Kai, Noor"* — which an LLM turns
into structured people, places, and relationships. Once a place exists, you edit
it with direct clicks: add/remove/rename people, tag the place, no LLM needed.

Pins are colored by relationship: 🟢 **lives · from · family** · 🔵 **visited** ·
🟡 **wishlist**. Places can also carry free-form **tags** (`ski resort`,
`holy site`, `money capital`, …).

> Rebuilt from a form-driven CRUD app into a text-in / structure-out tool. See
> `git log` for the original.

## Tech stack

- **Next.js 14** (App Router) · React · TypeScript · Tailwind
- **Postgres** on **Neon** via **Drizzle ORM** (no PostGIS — clustering is client-side)
- **react-map-gl / mapbox-gl** + **Supercluster** for the zoom-collapse map
- **Geocoding (3-tier):** Mapbox Geocoding v6 (admin places) → Mapbox Search Box (POIs) → OpenStreetMap/Nominatim (fallback)
- **Claude Haiku 4.5** (`@anthropic-ai/sdk`) for text→structure parsing (optional; a built-in quick parser runs without a key)

Architecture is **API-first** — all logic lives in `/app/api` route handlers and
`lib/server/*`, so a future iOS (Expo) client can reuse the same endpoints.
`lib/types.ts` and `lib/api-client.ts` are framework-agnostic on purpose.

## Setup

1. **Install:**
   ```bash
   npm install
   ```
2. **Database** — create a free Neon project at https://neon.tech (no card), then:
   ```bash
   cp .env.example .env   # paste your DATABASE_URL, Mapbox token, Anthropic key
   npm run db:migrate     # create the tables
   ```
3. **Tokens** (in `.env`):
   - `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` — public token for map tiles (URL-restrict it for prod)
   - `MAPBOX_TOKEN` — separate server token for geocoding (unrestricted; never shipped to the browser)
   - `ANTHROPIC_API_KEY` — optional; without it the built-in quick parser is used
   See `.env.example` for the full two-token explanation.
4. **(Optional) sample data:**
   ```bash
   npm run db:seed
   ```
5. **Run:**
   ```bash
   npm run dev   # http://localhost:3000
   ```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Apply migrations (non-interactive) |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:studio` | Browse the DB in Drizzle Studio |
| `npm run db:seed` | Insert sample data |
| `npm run db:reset` | Wipe all data (keeps schema) |

## Data model

- `raw_entries` — immutable source of truth (exactly what you typed/spoke)
- `people` — deduped by normalized name
- `places` — one point (lat/lng) + admin hierarchy; no polygons
- `person_place` — many-to-many with a typed relationship (`lives | from | family | visited | wishlist`)
- `place_tags` — free-form labels on a place

## Roadmap

- Disambiguation queue (catch low-confidence/ambiguous geocodes → "did you mean X or Y?")
- Tag-based map filtering
- Bulk-paste import UI (currently a one-off script)
- iOS via Expo (native share-sheet capture + on-device dictation) against this same API
