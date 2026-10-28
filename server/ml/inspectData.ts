import Papa from 'papaparse';
import type { ColumnSchemaItem, ObservationRow } from '../../src/types/ecotwin.ts';
import { resolveStationMetadata } from '../stations.ts';

export interface DatasetInspectionResult {
  rows: ObservationRow[];
  rawRowCount: number;
  columnCount: number;
  duplicateCount: number;
  invalidNumericTotal: number;
  missingPct: number;
  columnSchema: ColumnSchemaItem[];
  dateRange: { start: string | null; end: string | null };
  locations: string[];
  targetColumn: string;
  featureColumns: string[];
  validationStatus: 'Valid' | 'Valid with Warnings' | 'Invalid';
  validationNotes: string[];
}

const KNOWN_NUMERIC_CANDIDATES = new Set([
  'pm25',
  'pm2_5',
  'pm10',
  'no2',
  'so2',
  'co',
  'o3',
  'temperature_c',
  'temp',
  'temperature',
  'humidity_pct',
  'humidity',
  'wind_speed_ms',
  'wind_speed',
  'rainfall_mm',
  'rainfall',
  'green_index_ndvi',
  'ndvi',
  'latitude',
  'lat',
  'longitude',
  'lon',
  'lng',
]);

const COLUMN_ALIASES: Record<string, string> = {
  'pm2.5': 'pm25',
  pm2_5: 'pm25',
  timestamp: 'date',
  datetime: 'date',
  observed_at: 'date',
  station: 'location',
  city: 'location',
  site: 'location',
  lat: 'latitude',
  lon: 'longitude',
  lng: 'longitude',
  temp: 'temperature_c',
  temperature: 'temperature_c',
  humidity: 'humidity_pct',
  wind_speed: 'wind_speed_ms',
  rainfall: 'rainfall_mm',
  ndvi: 'green_index_ndvi',
};

export function normalizeColumnName(col: string): string {
  const cleaned = col.trim().toLowerCase().replace(/\s+/g, '_');
  return COLUMN_ALIASES[cleaned] || cleaned;
}

export function inspectCsvContent(
  csvText: string,
  preferredTarget = 'pm25'
): DatasetInspectionResult {
  const parsed = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const validationNotes: string[] = [];
  if (parsed.errors.length > 0) {
    validationNotes.push(`CSV parser reported ${parsed.errors.length} formatting notice(s).`);
  }

  const rawRows = parsed.data || [];
  const rawFields = parsed.meta.fields || [];

  if (rawRows.length === 0 || rawFields.length === 0) {
    return {
      rows: [],
      rawRowCount: 0,
      columnCount: 0,
      duplicateCount: 0,
      invalidNumericTotal: 0,
      missingPct: 100,
      columnSchema: [],
      dateRange: { start: null, end: null },
      locations: [],
      targetColumn: preferredTarget,
      featureColumns: [],
      validationStatus: 'Invalid',
      validationNotes: ['CSV file contains no readable header or data rows.'],
    };
  }

  const colMap: Record<string, string> = {};
  const normalizedCols: string[] = [];
  for (const rawCol of rawFields) {
    const norm = normalizeColumnName(rawCol);
    colMap[rawCol] = norm;
    if (!normalizedCols.includes(norm)) {
      normalizedCols.push(norm);
    }
  }

  if (!normalizedCols.includes('date')) {
    validationNotes.push('Missing required date/timestamp column (expected "date" or "timestamp").');
  }
  const resolvedTarget = normalizeColumnName(preferredTarget);
  if (!normalizedCols.includes(resolvedTarget)) {
    validationNotes.push(`Target column "${resolvedTarget}" not found in CSV headers.`);
  }

  // Detect duplicates and normalize rows
  const seenKeys = new Set<string>();
  let duplicateCount = 0;
  let totalCells = 0;
  let missingCells = 0;
  let invalidNumericTotal = 0;

  const missingByCol: Record<string, number> = {};
  const invalidNumByCol: Record<string, number> = {};
  const numericValuesByCol: Record<string, number[]> = {};
  const samplesByCol: Record<string, (string | number | null)[]> = {};

  for (const col of normalizedCols) {
    missingByCol[col] = 0;
    invalidNumByCol[col] = 0;
    numericValuesByCol[col] = [];
    samplesByCol[col] = [];
  }

  const normalizedRows: ObservationRow[] = [];

  for (const raw of rawRows) {
    const mapped: Record<string, string> = {};
    for (const [origKey, val] of Object.entries(raw)) {
      const normKey = colMap[origKey];
      if (normKey) {
        mapped[normKey] = typeof val === 'string' ? val.trim() : String(val ?? '').trim();
      }
    }

    const rawDate = mapped['date'] || '';
    const parsedTime = Date.parse(rawDate);
    const isoDate = Number.isNaN(parsedTime) ? rawDate : new Date(parsedTime).toISOString().slice(0, 10);
    const loc = mapped['location'] || 'Default Monitoring Station';

    const dedupeKey = `${isoDate}::${loc}`;
    if (seenKeys.has(dedupeKey)) {
      duplicateCount++;
      continue;
    }
    seenKeys.add(dedupeKey);

    const stationLookup = resolveStationMetadata(loc);

    const rowObj: ObservationRow = {
      date: isoDate,
      location: loc,
      station_code: mapped['station_code'] || stationLookup?.station_code,
      latitude: null,
      longitude: null,
      pm25: null,
      pm10: null,
      no2: null,
      so2: null,
      co: null,
      o3: null,
      temperature_c: null,
      humidity_pct: null,
      wind_speed_ms: null,
      rainfall_mm: null,
    };

    for (const col of normalizedCols) {
      totalCells++;
      const cell = mapped[col] ?? '';
      if (cell === '' || cell.toLowerCase() === 'na' || cell.toLowerCase() === 'null' || cell.toLowerCase() === 'nan') {
        missingCells++;
        missingByCol[col]++;
        if (samplesByCol[col].length < 4) samplesByCol[col].push(null);
        continue;
      }

      const isKnownNumeric = KNOWN_NUMERIC_CANDIDATES.has(col) || (col !== 'date' && col !== 'location' && col !== 'station_code');
      if (col === 'date') {
        rowObj.date = isoDate;
        if (samplesByCol[col].length < 4) samplesByCol[col].push(isoDate);
      } else if (col === 'location' || col === 'station_code') {
        rowObj[col] = cell;
        if (samplesByCol[col].length < 4) samplesByCol[col].push(cell);
      } else if (isKnownNumeric) {
        const num = Number(cell);
        if (Number.isNaN(num) || !Number.isFinite(num)) {
          invalidNumericTotal++;
          invalidNumByCol[col]++;
          missingCells++;
          missingByCol[col]++;
          rowObj[col] = null;
        } else {
          // Physical sanity check: negative concentrations are invalid sensor artifacts
          if (['pm25', 'pm10', 'no2', 'so2', 'co', 'o3', 'wind_speed_ms', 'rainfall_mm'].includes(col) && num < 0) {
            invalidNumericTotal++;
            invalidNumByCol[col]++;
            rowObj[col] = null;
          } else {
            rowObj[col] = num;
            numericValuesByCol[col].push(num);
            if (samplesByCol[col].length < 4) samplesByCol[col].push(num);
          }
        }
      } else {
        rowObj[col] = cell;
        if (samplesByCol[col].length < 4) samplesByCol[col].push(cell);
      }
    }

    // Apply documented station lookup coordinates ONLY if CSV lacks explicit lat/lon for a known station
    if (rowObj.latitude === null && stationLookup) {
      rowObj.latitude = stationLookup.latitude;
    }
    if (rowObj.longitude === null && stationLookup) {
      rowObj.longitude = stationLookup.longitude;
    }

    normalizedRows.push(rowObj);
  }

  // Sort chronologically
  normalizedRows.sort((a, b) => a.date.localeCompare(b.date) || a.location.localeCompare(b.location));

  const rowCount = normalizedRows.length;
  const columnSchema: ColumnSchemaItem[] = normalizedCols.map((col) => {
    const nums = numericValuesByCol[col];
    let dtype: ColumnSchemaItem['dtype'] = 'categorical';
    if (col === 'date') dtype = 'datetime';
    else if (nums.length > 0 || KNOWN_NUMERIC_CANDIDATES.has(col)) dtype = 'numeric';

    let min: number | null = null;
    let max: number | null = null;
    let mean: number | null = null;
    let median: number | null = null;
    let std: number | null = null;

    if (nums.length > 0) {
      const sorted = [...nums].sort((a, b) => a - b);
      min = Number(sorted[0].toFixed(3));
      max = Number(sorted[sorted.length - 1].toFixed(3));
      const sum = sorted.reduce((acc, v) => acc + v, 0);
      const avg = sum / sorted.length;
      mean = Number(avg.toFixed(3));
      const mid = Math.floor(sorted.length / 2);
      median = Number((sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]).toFixed(3));
      const variance = sorted.reduce((acc, v) => acc + (v - avg) ** 2, 0) / sorted.length;
      std = Number(Math.sqrt(variance).toFixed(3));
    }

    const mCount = missingByCol[col] || 0;
    return {
      name: col,
      dtype,
      missing_count: mCount,
      missing_pct: rowCount > 0 ? Number(((mCount / rowCount) * 100).toFixed(2)) : 0,
      invalid_numeric_count: invalidNumByCol[col] || 0,
      min,
      max,
      mean,
      median,
      std,
      sample_values: samplesByCol[col],
    };
  });

  const validDates = normalizedRows.map((r) => r.date).filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d));
  const dateRange = {
    start: validDates.length > 0 ? validDates[0] : null,
    end: validDates.length > 0 ? validDates[validDates.length - 1] : null,
  };

  const locations = Array.from(new Set(normalizedRows.map((r) => r.location))).sort();
  const missingPct = totalCells > 0 ? Number(((missingCells / totalCells) * 100).toFixed(2)) : 0;

  const excludedAsFeatures = new Set(['date', 'location', 'station_code', 'latitude', 'longitude', resolvedTarget]);
  const featureColumns = columnSchema
    .filter((c) => c.dtype === 'numeric' && !excludedAsFeatures.has(c.name) && c.missing_pct < 65)
    .map((c) => c.name);

  if (duplicateCount > 0) {
    validationNotes.push(`Removed ${duplicateCount} duplicate station-date record(s) during ingestion.`);
  }
  if (invalidNumericTotal > 0) {
    validationNotes.push(`Flagged and nullified ${invalidNumericTotal} invalid or negative numeric value(s).`);
  }
  if (missingPct > 0) {
    validationNotes.push(`Dataset contains ${missingPct}% missing cell values across all columns (handled via training-split median imputation).`);
  }
  if (rowCount < 30) {
    validationNotes.push(`Small sample warning: Only ${rowCount} valid rows found. Statistical models require larger time-series coverage for reliable evaluation.`);
  }

  let validationStatus: DatasetInspectionResult['validationStatus'] = 'Valid';
  if (!normalizedCols.includes('date') || !normalizedCols.includes(resolvedTarget) || rowCount < 10 || featureColumns.length === 0) {
    validationStatus = 'Invalid';
  } else if (duplicateCount > 0 || invalidNumericTotal > 0 || missingPct > 5 || rowCount < 50) {
    validationStatus = 'Valid with Warnings';
  }

  return {
    rows: normalizedRows,
    rawRowCount: rowCount,
    columnCount: normalizedCols.length,
    duplicateCount,
    invalidNumericTotal,
    missingPct,
    columnSchema,
    dateRange,
    locations,
    targetColumn: resolvedTarget,
    featureColumns,
    validationStatus,
    validationNotes,
  };
}
