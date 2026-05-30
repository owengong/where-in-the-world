// Geocoding: turn a place string into a point + admin hierarchy.
//
// Primary: Mapbox Geocoding v6 with permanent=true (better at messy/abbreviated
// input, proximity disambiguation, and bulk volume; clean `context` hierarchy).
// We MUST use permanent=true because we STORE coordinates — Mapbox's free
// "temporary" tier forbids caching. Cost is ~$5/1k but we cache one geocode per
// distinct place forever, so it's cents/year for a personal app.
//
// Fallback: OpenStreetMap Nominatim (free, no key, storage-OK under ODbL). Used
// when there's no Mapbox token, on a Mapbox error, OR when Mapbox returns no
// result — notably national parks, which Mapbox v6 dropped (POIs moved to the
// separate Search Box API) but OSM still has.
//
// Output is provider-neutral so swapping providers is contained to this file.

export type GeocodeResult = {
  name: string;
  lat: number;
  lng: number;
  placeType: string | null; // country | region | place | district | neighborhood | poi
  countryCode: string | null;
  countryName: string | null;
  regionCode: string | null;
  regionName: string | null;
  districtName: string | null;
  placeName: string | null;
  neighborhoodName: string | null;
  provider: 'mapbox' | 'nominatim';
  providerId: string | null;
};

export type GeocodeOpts = {
  /** Bias results toward this point to disambiguate (e.g. your home location). */
  proximity?: { lng: number; lat: number };
};

function mapboxToken(): string | undefined {
  return process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || undefined;
}

// Storing coordinates => must be permanent. Override only for local testing
// against an account without billing enabled (MAPBOX_PERMANENT=false).
function permanent(): boolean {
  return process.env.MAPBOX_PERMANENT !== 'false';
}

export async function geocodePlace(
  query: string,
  opts: GeocodeOpts = {},
): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;

  const token = mapboxToken();
  if (token && process.env.GEOCODER !== 'nominatim') {
    // 1) Admin places (cities, states, countries, neighborhoods) via Geocoding v6.
    try {
      const admin = await geocodeMapbox(q, token, opts);
      if (admin) return admin;
    } catch (e) {
      console.error('[geocode] Mapbox geocoding error for', q, e);
    }
    // 2) POIs (ski resorts, parks, landmarks, businesses) via Search Box —
    //    Geocoding v6 has no POIs, and OSM relevance for them is weak.
    try {
      const poi = await geocodeSearchBox(q, token, opts);
      if (poi) return poi;
    } catch (e) {
      console.error('[geocode] Mapbox Search Box error for', q, e);
    }
  }
  // 3) Last resort: OpenStreetMap.
  return geocodeNominatim(q);
}

// --- Mapbox Geocoding v6 ------------------------------------------------------

function mapboxFeatureType(t?: string): string | null {
  switch (t) {
    case 'country':
    case 'region':
    case 'district':
    case 'place':
    case 'neighborhood':
      return t;
    case 'locality':
      return 'place';
    case 'postcode':
    case 'address':
    case 'street':
      return 'poi';
    default:
      return t || null;
  }
}

async function geocodeMapbox(
  q: string,
  token: string,
  opts: GeocodeOpts,
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    q,
    access_token: token,
    limit: '1',
    permanent: permanent() ? 'true' : 'false',
  });
  if (opts.proximity) params.set('proximity', `${opts.proximity.lng},${opts.proximity.lat}`);

  const res = await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`);
  if (!res.ok) throw new Error(`Mapbox ${res.status}: ${await res.text().catch(() => '')}`);

  const data = (await res.json()) as any;
  const f = data?.features?.[0];
  if (!f) return null;

  const coords = f.geometry?.coordinates;
  const lng = Number(coords?.[0] ?? f.properties?.coordinates?.longitude);
  const lat = Number(coords?.[1] ?? f.properties?.coordinates?.latitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const props = f.properties ?? {};

  // Mapbox Geocoding v6 has NO POIs. For a POI query ("Snowbird Ski Resort",
  // "Yosemite") it returns a weak street/address/postcode match that's almost
  // always wrong — so accept only real admin places here and let the OSM
  // fallback (which has POIs) handle everything else.
  const ADMIN_TYPES = new Set(['country', 'region', 'district', 'place', 'locality', 'neighborhood']);
  if (!ADMIN_TYPES.has(props.feature_type)) return null;

  const ctx = props.context ?? {};
  const ftype = mapboxFeatureType(props.feature_type);
  const selfName = props.name as string | undefined;

  // Fill the level the feature itself represents from its own name when context
  // doesn't echo it back.
  const placeName = ctx.place?.name ?? (ftype === 'place' ? selfName : null) ?? null;
  const neighborhoodName =
    ctx.neighborhood?.name ?? (ftype === 'neighborhood' ? selfName : null) ?? null;
  const regionName = ctx.region?.name ?? (ftype === 'region' ? selfName : null) ?? null;
  const countryName = ctx.country?.name ?? (ftype === 'country' ? selfName : null) ?? null;

  return {
    name: selfName || placeName || regionName || countryName || q,
    lat,
    lng,
    placeType: ftype,
    countryCode: ctx.country?.country_code ? String(ctx.country.country_code).toUpperCase() : null,
    countryName,
    regionCode: ctx.region?.region_code_full || ctx.region?.region_code || null,
    regionName,
    districtName: ctx.district?.name ?? null,
    placeName,
    neighborhoodName,
    provider: 'mapbox',
    providerId: props.mapbox_id ?? null,
  };
}

// --- Mapbox Search Box (POIs) ------------------------------------------------
// Covers the 330M-POI dataset that Geocoding v6 dropped (ski resorts, parks,
// landmarks, businesses). Tip: include a city/country in the query to
// disambiguate globally-shared names ("Eiffel Tower Paris").

async function geocodeSearchBox(
  q: string,
  token: string,
  opts: GeocodeOpts,
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({ q, access_token: token, limit: '1' });
  if (opts.proximity) params.set('proximity', `${opts.proximity.lng},${opts.proximity.lat}`);

  const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/forward?${params.toString()}`);
  if (!res.ok) throw new Error(`SearchBox ${res.status}: ${await res.text().catch(() => '')}`);

  const data = (await res.json()) as any;
  const f = data?.features?.[0];
  if (!f) return null;

  const coords = f.geometry?.coordinates;
  const lng = Number(coords?.[0]);
  const lat = Number(coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const props = f.properties ?? {};
  const ctx = props.context ?? {};

  return {
    name: props.name || q,
    lat,
    lng,
    placeType: props.feature_type === 'poi' ? 'poi' : mapboxFeatureType(props.feature_type),
    countryCode: ctx.country?.country_code ? String(ctx.country.country_code).toUpperCase() : null,
    countryName: ctx.country?.name ?? null,
    regionCode: ctx.region?.region_code_full || ctx.region?.region_code || null,
    regionName: ctx.region?.name ?? null,
    districtName: ctx.district?.name ?? null,
    placeName: ctx.place?.name ?? null,
    neighborhoodName: ctx.neighborhood?.name ?? null,
    provider: 'mapbox',
    providerId: props.mapbox_id ?? null,
  };
}

// --- OpenStreetMap Nominatim (fallback) --------------------------------------

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT =
  'where-in-the-world/0.1 (personal project; https://github.com/owengong/where-in-the-world)';

function nominatimPlaceType(addresstype?: string, klass?: string, type?: string): string | null {
  const a = (addresstype || '').toLowerCase();
  if (a === 'country') return 'country';
  if (a === 'state' || a === 'province' || a === 'region') return 'region';
  if (a === 'county') return 'district';
  if (['city', 'town', 'village', 'municipality', 'hamlet'].includes(a)) return 'place';
  if (['suburb', 'neighbourhood', 'quarter', 'borough', 'city_district'].includes(a))
    return 'neighborhood';
  if (klass === 'boundary' && type === 'national_park') return 'poi';
  if (['leisure', 'tourism', 'natural', 'amenity', 'historic'].includes(klass || '')) return 'poi';
  return a || null;
}

async function geocodeNominatim(q: string): Promise<GeocodeResult | null> {
  const url = `${NOMINATIM}?format=jsonv2&addressdetails=1&limit=1&q=${encodeURIComponent(q)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  } catch (e) {
    console.error('[geocode] Nominatim network error for', q, e);
    return null;
  }
  if (!res.ok) {
    console.error('[geocode] Nominatim non-ok', res.status, 'for', q);
    return null;
  }

  const data = (await res.json()) as any[];
  const f = Array.isArray(data) ? data[0] : null;
  if (!f) return null;

  const addr = f.address ?? {};
  const lat = Number(f.lat);
  const lng = Number(f.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const placeName =
    addr.city || addr.town || addr.village || addr.municipality || addr.hamlet || null;
  const neighborhoodName = addr.suburb || addr.neighbourhood || addr.quarter || null;
  const regionName = addr.state || addr.region || addr.province || null;
  const countryName = addr.country || null;

  const name =
    neighborhoodName ||
    placeName ||
    regionName ||
    countryName ||
    f.name ||
    String(f.display_name || q).split(',')[0].trim();

  return {
    name,
    lat,
    lng,
    placeType: nominatimPlaceType(f.addresstype, f.class, f.type),
    countryCode: addr.country_code ? String(addr.country_code).toUpperCase() : null,
    countryName,
    regionCode: addr['ISO3166-2-lvl4'] || null,
    regionName,
    districtName: addr.county || null,
    placeName,
    neighborhoodName,
    provider: 'nominatim',
    providerId: f.osm_type && f.osm_id ? `${f.osm_type}/${f.osm_id}` : null,
  };
}
