import { haversineDistanceKm } from '../geoResolver';

describe('haversineDistanceKm', () => {
  it('computes ~5570km between New York and London', () => {
    const ny = { country: 'US', latitude: 40.7128, longitude: -74.006 };
    const london = { country: 'GB', latitude: 51.5074, longitude: -0.1278 };
    const distance = haversineDistanceKm(ny, london);
    expect(Math.abs(distance - 5570) / 5570).toBeLessThan(0.02);
  });

  it('computes ~13357km between Sydney and Sao Paulo', () => {
    const sydney = { country: 'AU', latitude: -33.8688, longitude: 151.2093 };
    const saoPaulo = { country: 'BR', latitude: -23.5505, longitude: -46.6333 };
    const distance = haversineDistanceKm(sydney, saoPaulo);
    expect(Math.abs(distance - 13400) / 13400).toBeLessThan(0.02);
  });

  it('returns ~0 for the same point', () => {
    const point = { country: 'US', latitude: 40.7128, longitude: -74.006 };
    expect(haversineDistanceKm(point, point)).toBeLessThan(0.001);
  });

  it('is symmetric (distance A→B equals B→A)', () => {
    const a = { country: 'JP', latitude: 35.6762, longitude: 139.6503 };
    const b = { country: 'FR', latitude: 48.8566, longitude: 2.3522 };
    expect(haversineDistanceKm(a, b)).toBeCloseTo(haversineDistanceKm(b, a), 6);
  });
});
