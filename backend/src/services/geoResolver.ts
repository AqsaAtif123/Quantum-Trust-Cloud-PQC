/**
 * IP-to-geolocation resolution for impossible-travel detection. This
 * sandbox has no network access to a geo-IP API (MaxMind, ipapi.co, etc.)
 * and bundling a full GeoLite2 database is out of scope here, so the
 * default resolver honestly returns null — "insufficient location data" —
 * rather than fabricating coordinates. Impossible-travel detection is
 * structurally wired up (see aiCoPilot.ts) but stays inert until a real
 * resolver is plugged in below.
 *
 * To make this real: implement GeoResolver against MaxMind's GeoLite2
 * (local database, no per-request network call) or a hosted API, and
 * swap NullGeoResolver for it in getGeoResolver().
 */
export interface GeoLocation {
  country: string; // ISO 3166-1 alpha-2
  latitude: number;
  longitude: number;
}

export interface GeoResolver {
  resolve(ipAddress: string): Promise<GeoLocation | null>;
}

class NullGeoResolver implements GeoResolver {
  async resolve(): Promise<GeoLocation | null> {
    return null;
  }
}

const resolver: GeoResolver = new NullGeoResolver();

export function getGeoResolver(): GeoResolver {
  return resolver;
}

/** Great-circle distance in km — used by aiCoPilot to compute implied travel speed once a real resolver is wired in. */
export function haversineDistanceKm(a: GeoLocation, b: GeoLocation): number {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
