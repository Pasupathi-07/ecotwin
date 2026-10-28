import fs from 'node:fs';
import path from 'node:path';
import type { AirQualityStandard, StationMetadata } from '../src/types/ecotwin.ts';

export const STATION_LOOKUP: Record<string, StationMetadata> = {
  'Chennai - Alandur': {
    location: 'Chennai - Alandur',
    station_code: 'TN-CHN-01',
    city: 'Chennai',
    region: 'Tamil Nadu (Coastal Urban)',
    latitude: 13.0025,
    longitude: 80.2060,
    zone_type: 'Urban Traffic',
    elevation_m: 14,
  },
  'Bengaluru - BTM Layout': {
    location: 'Bengaluru - BTM Layout',
    station_code: 'KA-BLR-02',
    city: 'Bengaluru',
    region: 'Karnataka (Deccan Plateau)',
    latitude: 12.9135,
    longitude: 77.5933,
    zone_type: 'Residential',
    elevation_m: 912,
  },
  'Coimbatore - SIDCO': {
    location: 'Coimbatore - SIDCO',
    station_code: 'TN-CBE-03',
    city: 'Coimbatore',
    region: 'Tamil Nadu (Western Ghats Foothills)',
    latitude: 10.9412,
    longitude: 76.9781,
    zone_type: 'Industrial',
    elevation_m: 411,
  },
  'Hyderabad - Zoo Park': {
    location: 'Hyderabad - Zoo Park',
    station_code: 'TS-HYD-04',
    city: 'Hyderabad',
    region: 'Telangana (Semi-Arid Urban)',
    latitude: 17.3497,
    longitude: 78.4513,
    zone_type: 'Peri-Urban Background',
    elevation_m: 505,
  },
  'Mumbai - Bandra': {
    location: 'Mumbai - Bandra',
    station_code: 'MH-MUM-05',
    city: 'Mumbai',
    region: 'Maharashtra (Arabian Sea Coast)',
    latitude: 19.0627,
    longitude: 72.8461,
    zone_type: 'Urban Traffic',
    elevation_m: 11,
  },
  'New Delhi - RK Puram': {
    location: 'New Delhi - RK Puram',
    station_code: 'DL-NDL-06',
    city: 'New Delhi',
    region: 'Indo-Gangetic Plain',
    latitude: 28.5633,
    longitude: 77.1869,
    zone_type: 'Urban Traffic',
    elevation_m: 225,
  },
};

export function resolveStationMetadata(locationName: string): StationMetadata | null {
  if (STATION_LOOKUP[locationName]) {
    return STATION_LOOKUP[locationName];
  }
  const normalized = locationName.trim().toLowerCase();
  for (const [key, meta] of Object.entries(STATION_LOOKUP)) {
    if (key.toLowerCase() === normalized || meta.city.toLowerCase() === normalized || meta.station_code.toLowerCase() === normalized) {
      return meta;
    }
  }
  return null;
}

export function classifyPM25(
  value: number,
  standard: AirQualityStandard = 'CPCB_NAAQS'
): {
  standard: AirQualityStandard;
  band: string;
  threshold_ugm3: number;
  exceedance_ratio: number;
  severity: 'low' | 'moderate' | 'elevated' | 'critical';
} {
  if (standard === 'WHO_2021') {
    const guideline = 15.0;
    const ratio = Number((value / guideline).toFixed(2));
    if (value <= 15) {
      return { standard, band: 'Meets WHO 24h Guideline (<= 15 ug/m3)', threshold_ugm3: guideline, exceedance_ratio: ratio, severity: 'low' };
    }
    if (value <= 37.5) {
      return { standard, band: 'WHO Interim Target 3 (15 - 37.5 ug/m3)', threshold_ugm3: guideline, exceedance_ratio: ratio, severity: 'moderate' };
    }
    if (value <= 75) {
      return { standard, band: 'WHO Interim Target 1-2 (37.5 - 75 ug/m3)', threshold_ugm3: guideline, exceedance_ratio: ratio, severity: 'elevated' };
    }
    return { standard, band: 'Exceeds WHO Interim Target 1 (> 75 ug/m3)', threshold_ugm3: guideline, exceedance_ratio: ratio, severity: 'critical' };
  }

  // Default: CPCB NAAQS 24-hour PM2.5 standard (60 ug/m3)
  const threshold = 60.0;
  const ratio = Number((value / threshold).toFixed(2));
  if (value <= 30) {
    return { standard, band: 'Good (0 - 30 ug/m3)', threshold_ugm3: threshold, exceedance_ratio: ratio, severity: 'low' };
  }
  if (value <= 60) {
    return { standard, band: 'Satisfactory (31 - 60 ug/m3)', threshold_ugm3: threshold, exceedance_ratio: ratio, severity: 'moderate' };
  }
  if (value <= 90) {
    return { standard, band: 'Moderately Polluted (61 - 90 ug/m3)', threshold_ugm3: threshold, exceedance_ratio: ratio, severity: 'elevated' };
  }
  return { standard, band: 'Poor to Severe (> 90 ug/m3)', threshold_ugm3: threshold, exceedance_ratio: ratio, severity: 'critical' };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussianRandom(rng: () => number, mean = 0, std = 1): number {
  const u1 = Math.max(1e-7, rng());
  const u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * std;
}

/**
 * Generates clearly documented, deterministic sample datasets on first boot
 * so the software-only environmental digital-twin prototype runs completely out-of-the-box
 * without external API keys or live sensor hardware.
 */
export function ensureDemoDatasetsOnDisk(datasetsDir: string): {
  primaryDemoCsvPath: string;
  compactValidationCsvPath: string;
} {
  fs.mkdirSync(datasetsDir, { recursive: true });
  const primaryPath = path.join(datasetsDir, 'demo_regional_air_quality_2025_2026.csv');
  const compactPath = path.join(datasetsDir, 'demo_compact_station_test.csv');

  if (!fs.existsSync(primaryPath)) {
    const rng = mulberry32(20261028);
    const stations = Object.values(STATION_LOOKUP);
    const stationBaselines: Record<string, { pm25Base: number; no2Base: number; so2Base: number; tempBase: number; humBase: number; windBase: number; ndviBase: number }> = {
      'Chennai - Alandur': { pm25Base: 36, no2Base: 28, so2Base: 9.5, tempBase: 29.5, humBase: 74, windBase: 3.8, ndviBase: 0.28 },
      'Bengaluru - BTM Layout': { pm25Base: 31, no2Base: 25, so2Base: 7.2, tempBase: 24.8, humBase: 61, windBase: 3.2, ndviBase: 0.39 },
      'Coimbatore - SIDCO': { pm25Base: 41, no2Base: 31, so2Base: 14.8, tempBase: 27.6, humBase: 63, windBase: 3.5, ndviBase: 0.34 },
      'Hyderabad - Zoo Park': { pm25Base: 44, no2Base: 33, so2Base: 10.6, tempBase: 27.2, humBase: 55, windBase: 2.9, ndviBase: 0.31 },
      'Mumbai - Bandra': { pm25Base: 52, no2Base: 39, so2Base: 12.4, tempBase: 28.8, humBase: 76, windBase: 3.6, ndviBase: 0.24 },
      'New Delhi - RK Puram': { pm25Base: 98, no2Base: 56, so2Base: 16.5, tempBase: 21.5, humBase: 58, windBase: 2.1, ndviBase: 0.26 },
    };

    const startDate = new Date('2025-10-15T00:00:00Z');
    const totalDays = 180; // 180 days * 6 stations = 1080 records

    const header = [
      'date',
      'location',
      'station_code',
      'latitude',
      'longitude',
      'pm25',
      'pm10',
      'no2',
      'so2',
      'co',
      'o3',
      'temperature_c',
      'humidity_pct',
      'wind_speed_ms',
      'rainfall_mm',
      'green_index_ndvi',
    ].join(',');

    const lines: string[] = [header];

    // Track per-station previous day PM2.5 for realistic temporal autocorrelation
    const prevPm25: Record<string, number> = {};
    for (const st of stations) {
      prevPm25[st.location] = stationBaselines[st.location].pm25Base;
    }

    for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
      const current = new Date(startDate.getTime() + dayIdx * 86400000);
      const dateStr = current.toISOString().slice(0, 10);
      const dayOfYear = Math.floor((current.getTime() - Date.UTC(current.getUTCFullYear(), 0, 0)) / 86400000);
      // Winter inversion factor peaks around late Dec / early Jan
      const winterFactor = Math.cos(((dayOfYear - 5) / 365) * 2 * Math.PI);

      for (const st of stations) {
        const cfg = stationBaselines[st.location];
        const seasonalAmp = st.location.includes('Delhi') ? 46 : st.location.includes('Mumbai') || st.location.includes('Hyderabad') ? 18 : 11;

        const temp = Number((cfg.tempBase - winterFactor * (st.location.includes('Delhi') ? 8.5 : 3.2) + gaussianRandom(rng, 0, 1.4)).toFixed(1));
        const rainfallRaw = rng() < (winterFactor < -0.1 ? 0.26 : 0.10) ? Math.max(0.5, gaussianRandom(rng, 9.5, 6.2)) : 0;
        const rainfall = Number(rainfallRaw.toFixed(1));
        const humidity = Number(Math.min(96, Math.max(26, cfg.humBase + (rainfall > 0 ? 14 : 0) + winterFactor * 4 + gaussianRandom(rng, 0, 6.5))).toFixed(1));
        const wind = Number(Math.max(0.5, cfg.windBase - winterFactor * 0.65 + gaussianRandom(rng, 0, 0.75)).toFixed(2));

        const no2 = Number(Math.max(6, cfg.no2Base + winterFactor * 9.5 - wind * 1.9 + gaussianRandom(rng, 0, 4.2)).toFixed(1));
        const so2 = Number(Math.max(2.5, cfg.so2Base + winterFactor * 2.4 + gaussianRandom(rng, 0, 1.8)).toFixed(1));
        const co = Number(Math.max(0.25, 0.42 + no2 * 0.024 + gaussianRandom(rng, 0, 0.12)).toFixed(2));
        const o3 = Number(Math.max(8, 44 - winterFactor * 11 + (temp - 25) * 1.3 - no2 * 0.22 + gaussianRandom(rng, 0, 5.0)).toFixed(1));
        const ndvi = Number(Math.min(0.68, Math.max(0.14, cfg.ndviBase + (rainfall > 0 ? 0.02 : 0) - winterFactor * 0.02 + gaussianRandom(rng, 0, 0.015))).toFixed(3));

        // Deterministic physical relationship + autoregressive memory + small atmospheric noise
        const deterministicTarget =
          cfg.pm25Base * 0.32 +
          prevPm25[st.location] * 0.34 +
          winterFactor * seasonalAmp * 0.45 +
          no2 * 0.62 +
          so2 * 0.48 -
          wind * 4.4 -
          rainfall * 0.68 +
          (humidity > 72 ? (humidity - 72) * 0.28 : 0) -
          (temp - cfg.tempBase) * 0.55;

        const pm25Val = Number(Math.max(7.5, deterministicTarget + gaussianRandom(rng, 0, 4.3)).toFixed(1));
        prevPm25[st.location] = pm25Val;

        const dustRatio = st.zone_type === 'Industrial' ? 2.15 : st.location.includes('Delhi') ? 1.95 : 1.72;
        const pm10Val = Number(Math.max(pm25Val + 6, pm25Val * dustRatio + wind * 2.1 - rainfall * 1.1 + gaussianRandom(rng, 0, 6.5)).toFixed(1));

        // Introduce ~1.2% realistic sensor missingness on non-date/location columns for honest QA validation
        const maybeBlank = (val: number, prob = 0.012): string => (rng() < prob ? '' : String(val));

        lines.push(
          [
            dateStr,
            st.location,
            st.station_code,
            st.latitude.toFixed(4),
            st.longitude.toFixed(4),
            String(pm25Val),
            maybeBlank(pm10Val, 0.015),
            maybeBlank(no2, 0.01),
            maybeBlank(so2, 0.01),
            maybeBlank(co, 0.01),
            maybeBlank(o3, 0.012),
            maybeBlank(temp, 0.008),
            maybeBlank(humidity, 0.008),
            maybeBlank(wind, 0.01),
            String(rainfall),
            String(ndvi),
          ].join(',')
        );
      }
    }

    fs.writeFileSync(primaryPath, lines.join('\n'), 'utf-8');
  }

  if (!fs.existsSync(compactPath)) {
    // Extract a 120-row two-station subset for rapid testing & comparison
    const rawLines = fs.readFileSync(primaryPath, 'utf-8').split('\n');
    const header = rawLines[0];
    const subset = rawLines
      .slice(1)
      .filter((line) => line.includes('Chennai - Alandur') || line.includes('Coimbatore - SIDCO'))
      .slice(0, 120);
    fs.writeFileSync(compactPath, [header, ...subset].join('\n'), 'utf-8');
  }

  return {
    primaryDemoCsvPath: primaryPath,
    compactValidationCsvPath: compactPath,
  };
}
