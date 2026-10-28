import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import Papa from 'papaparse';
import { z } from 'zod';
import type {
  AirQualityStandard,
  DashboardSummaryResponse,
  EnvironmentalAlert,
  LocationSummaryItem,
  ObservationRow,
  ScenarioComparisonResult,
} from '../src/types/ecotwin.ts';
import {
  db,
  getActiveModelRecord,
  getModelRecordById,
  loadDatasetObservations,
  mapDatasetRow,
  mapModelVersionRow,
  mapPredictionRow,
  mapReportRow,
  mapScenarioRow,
  MODELS_DIR,
  REPORTS_DIR,
  UPLOADS_DIR,
} from './db.ts';
import { inspectCsvContent } from './ml/inspectData.ts';
import { loadModelArtifact, runArtifactInference, trainAndSerializeModel } from './ml/pipeline.ts';
import { buildChronologicalRecords, getFeatureLabel, getFeatureUnit } from './ml/preprocess.ts';
import { generateRuleBasedRecommendations } from './recommendations.ts';
import { classifyPM25, resolveStationMetadata } from './stations.ts';

export const apiRouter = express.Router();

const maxUploadBytes = Number(process.env.ECOTWIN_MAX_UPLOAD_MB || 10) * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes, files: 1 },
});

function sanitizeFilename(rawName: string): string {
  const base = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.endsWith('.csv') ? base : `${base}.csv`;
}

function avgOf(vals: (number | null | undefined)[]): number | null {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

// 1. Health Check
apiRouter.get('/health', (_req, res) => {
  try {
    const dsCount = (db.prepare('SELECT COUNT(*) as c FROM datasets').get() as { c: number }).c;
    const activeModel = getActiveModelRecord();
    res.json({
      status: 'ok',
      service: 'EcoTwin AI Environmental Decision Support API',
      database: 'connected',
      datasets_count: dsCount,
      active_model: activeModel
        ? {
            id: activeModel.id,
            version: activeModel.version,
            algorithm: activeModel.algorithm,
            is_demo: Boolean(activeModel.is_demo_dataset),
          }
        : null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(500).json({ error: 'Database health check failed.' });
  }
});

// 2. Dashboard Summary & Aggregations
apiRouter.get('/dashboard/summary', (req, res) => {
  try {
    const requestedDatasetId = req.query.dataset_id ? Number(req.query.dataset_id) : null;
    const locationFilter = typeof req.query.location === 'string' ? req.query.location : 'All Locations';
    const startDate = typeof req.query.start_date === 'string' && req.query.start_date ? req.query.start_date : null;
    const endDate = typeof req.query.end_date === 'string' && req.query.end_date ? req.query.end_date : null;
    const interval = typeof req.query.interval === 'string' ? req.query.interval : 'daily';
    const standard: AirQualityStandard = req.query.standard === 'WHO_2021' ? 'WHO_2021' : 'CPCB_NAAQS';

    const dsRow = requestedDatasetId
      ? (db.prepare('SELECT * FROM datasets WHERE id = ?').get(requestedDatasetId) as Record<string, unknown> | undefined)
      : (db.prepare('SELECT * FROM datasets ORDER BY is_demo ASC, id ASC LIMIT 1').get() as Record<string, unknown> | undefined);

    const activeModelFull = getActiveModelRecord();
    const activeModel = activeModelFull
      ? (() => {
          const { artifact_path: _unused, ...clean } = activeModelFull;
          return clean;
        })()
      : null;

    if (!dsRow) {
      const emptyResponse: DashboardSummaryResponse = {
        dataset: null,
        active_model: activeModel,
        selected_location: locationFilter,
        selected_standard: standard,
        kpis: {
          latest_pm25: { value: null, date: null, location: locationFilter, sparkline: [] },
          latest_pm10: { value: null, date: null, location: locationFilter, sparkline: [] },
          period_avg_pm25: { value: null, start: null, end: null, count: 0, min: null, max: null },
          location_count: 0,
          model_status: {
            ready: Boolean(activeModel),
            version: activeModel?.version ?? null,
            mae: activeModel?.metrics.mae ?? null,
            rmse: activeModel?.metrics.rmse ?? null,
            is_demo: Boolean(activeModel?.is_demo_dataset),
          },
          latest_timestamp: null,
        },
        time_series: [],
        monthly_patterns: [],
        location_comparisons: [],
        evaluation_preview: activeModel?.evaluation_series.slice(-60) ?? [],
        alerts: [
          {
            id: 'alert-no-dataset',
            type: 'data_quality',
            severity: 'warning',
            title: 'No Dataset Available',
            message: 'Upload a CSV dataset in Dataset Explorer to populate historical air-quality metrics.',
          },
        ],
      };
      res.json(emptyResponse);
      return;
    }

    const dataset = mapDatasetRow(dsRow);
    const allRows = loadDatasetObservations(dataset.id);

    // Date-filtered rows across all locations (for location comparisons & map)
    const dateFilteredRows = allRows.filter((r) => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      return true;
    });

    // Location + date-filtered rows for selected focus charts
    const scopedRows =
      locationFilter && locationFilter !== 'All Locations'
        ? dateFilteredRows.filter((r) => r.location === locationFilter)
        : dateFilteredRows;

    // Optional artifact load for station latest model estimates
    let loadedArtifact: ReturnType<typeof loadModelArtifact> | null = null;
    if (activeModelFull) {
      try {
        loadedArtifact = loadModelArtifact(activeModelFull.artifact_path);
      } catch {
        loadedArtifact = null;
      }
    }

    // Build Location Comparisons (also powers Environmental Twin Map!)
    const enrichedAll = buildChronologicalRecords(allRows, dataset.target_column || 'pm25');
    const latestEnrichedByLoc = new Map<string, (typeof enrichedAll)[number]>();
    for (const r of enrichedAll) {
      if (startDate && r.date < startDate) continue;
      if (endDate && r.date > endDate) continue;
      latestEnrichedByLoc.set(r.location, r);
    }

    const rowsByLoc = new Map<string, ObservationRow[]>();
    for (const r of dateFilteredRows) {
      const arr = rowsByLoc.get(r.location) || [];
      arr.push(r);
      rowsByLoc.set(r.location, arr);
    }

    const locationComparisons: LocationSummaryItem[] = Array.from(rowsByLoc.entries())
      .map(([locName, locRows]) => {
        const sortedLoc = [...locRows].sort((a, b) => a.date.localeCompare(b.date));
        const latestObsPm25Row = [...sortedLoc].reverse().find((r) => typeof r.pm25 === 'number');
        const latestObsPm10Row = [...sortedLoc].reverse().find((r) => typeof r.pm10 === 'number');
        const latestAny = sortedLoc[sortedLoc.length - 1];
        const meta = resolveStationMetadata(locName);

        const lat = latestAny?.latitude ?? meta?.latitude ?? null;
        const lon = latestAny?.longitude ?? meta?.longitude ?? null;
        const avgPm25 = avgOf(sortedLoc.map((r) => r.pm25));

        let modelEst: number | null = null;
        const enrichedLatest = latestEnrichedByLoc.get(locName);
        if (loadedArtifact && enrichedLatest) {
          try {
            const inputMap: Record<string, number | null> = {};
            for (const f of loadedArtifact.features) {
              const v = enrichedLatest[f];
              inputMap[f] = typeof v === 'number' && Number.isFinite(v) ? v : null;
            }
            modelEst = runArtifactInference(loadedArtifact, inputMap, standard).predictedValue;
          } catch {
            modelEst = null;
          }
        }

        const refVal = latestObsPm25Row?.pm25 ?? avgPm25 ?? 0;
        const riskBand = classifyPM25(refVal, standard).band;

        return {
          location: locName,
          latitude: lat,
          longitude: lon,
          zone_type: meta?.zone_type ?? 'Monitoring Station',
          latest_date: latestAny?.date ?? '',
          latest_pm25: latestObsPm25Row?.pm25 ?? null,
          latest_pm10: latestObsPm10Row?.pm10 ?? null,
          avg_pm25: avgPm25,
          avg_pm10: avgOf(sortedLoc.map((r) => r.pm10)),
          avg_no2: avgOf(sortedLoc.map((r) => r.no2)),
          avg_temp: avgOf(sortedLoc.map((r) => r.temperature_c)),
          avg_wind: avgOf(sortedLoc.map((r) => r.wind_speed_ms)),
          observation_count: sortedLoc.length,
          missing_pm25_count: sortedLoc.filter((r) => r.pm25 === null).length,
          model_estimate_pm25: modelEst,
          risk_category: riskBand,
          trend_sparkline: sortedLoc.slice(-21).map((r) => ({ date: r.date, pm25: r.pm25 })),
        };
      })
      .sort((a, b) => (b.avg_pm25 ?? 0) - (a.avg_pm25 ?? 0));

    // Aggregate time_series by date (or weekly / monthly interval)
    const bucketKey = (dateStr: string): string => {
      if (interval === 'monthly') return dateStr.slice(0, 7);
      if (interval === 'weekly') {
        const dt = new Date(`${dateStr}T00:00:00Z`);
        if (Number.isNaN(dt.getTime())) return dateStr;
        const day = dt.getUTCDay();
        const mondayOffset = (day + 6) % 7;
        const weekStart = new Date(dt.getTime() - mondayOffset * 86400000);
        return weekStart.toISOString().slice(0, 10);
      }
      return dateStr;
    };

    const groupedByBucket = new Map<string, ObservationRow[]>();
    for (const r of scopedRows) {
      const k = bucketKey(r.date);
      const list = groupedByBucket.get(k) || [];
      list.push(r);
      groupedByBucket.set(k, list);
    }

    const timeSeries = Array.from(groupedByBucket.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([bucket, bucketRows]) => ({
        date: bucket,
        pm25: avgOf(bucketRows.map((r) => r.pm25)),
        pm10: avgOf(bucketRows.map((r) => r.pm10)),
        no2: avgOf(bucketRows.map((r) => r.no2)),
        so2: avgOf(bucketRows.map((r) => r.so2)),
        o3: avgOf(bucketRows.map((r) => r.o3)),
        co: avgOf(bucketRows.map((r) => r.co)),
        temperature_c: avgOf(bucketRows.map((r) => r.temperature_c)),
        humidity_pct: avgOf(bucketRows.map((r) => r.humidity_pct)),
        wind_speed_ms: avgOf(bucketRows.map((r) => r.wind_speed_ms)),
      }));

    // Monthly patterns
    const byMonth = new Map<string, ObservationRow[]>();
    for (const r of scopedRows) {
      const m = r.date.slice(0, 7);
      const list = byMonth.get(m) || [];
      list.push(r);
      byMonth.set(m, list);
    }
    const monthlyPatterns = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, mRows]) => ({
        month,
        pm25_avg: avgOf(mRows.map((r) => r.pm25)),
        pm10_avg: avgOf(mRows.map((r) => r.pm10)),
        no2_avg: avgOf(mRows.map((r) => r.no2)),
        record_count: mRows.length,
      }));

    // Compute KPIs from actual filtered data
    const dailyPm25Series = timeSeries.map((t) => t.pm25).filter((v): v is number => v !== null);
    const dailyPm10Series = timeSeries.map((t) => t.pm10).filter((v): v is number => v !== null);

    const latestPm25Entry = [...timeSeries].reverse().find((t) => t.pm25 !== null);
    const latestPm10Entry = [...timeSeries].reverse().find((t) => t.pm10 !== null);

    const rawPm25Vals = scopedRows.map((r) => r.pm25).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const periodAvgPm25 = avgOf(rawPm25Vals);
    const minPm25 = rawPm25Vals.length > 0 ? Math.min(...rawPm25Vals) : null;
    const maxPm25 = rawPm25Vals.length > 0 ? Math.max(...rawPm25Vals) : null;

    // Generate Data-Driven Environmental Alerts (explicitly separating observed vs model prediction alerts)
    const alerts: EnvironmentalAlert[] = [];
    const threshold = standard === 'WHO_2021' ? 15 : 60;
    const stdName = standard === 'WHO_2021' ? 'WHO 2021 24h Guideline (15 ug/m3)' : 'CPCB NAAQS 24h Standard (60 ug/m3)';

    if (dataset.is_demo) {
      alerts.push({
        id: 'alert-demo-provenance',
        type: 'data_quality',
        severity: 'info',
        title: 'Demonstration Dataset Active',
        message: 'DEMO DATA — Illustrative or sample data, not live environmental observations. Upload station CSV data in Dataset Explorer for external analysis.',
        timestamp: dataset.date_range.end ?? undefined,
      });
    }

    if (latestPm25Entry && latestPm25Entry.pm25 !== null && latestPm25Entry.pm25 > threshold) {
      alerts.push({
        id: 'alert-observed-pm25',
        type: 'observed',
        severity: latestPm25Entry.pm25 > threshold * 1.5 ? 'critical' : 'warning',
        title: `Observed PM2.5 Exceeds ${standard === 'WHO_2021' ? 'WHO Guideline' : 'NAAQS Threshold'}`,
        message: `Latest recorded PM2.5 for ${locationFilter} on ${latestPm25Entry.date} is ${latestPm25Entry.pm25} ug/m3 (reference threshold: ${threshold} ug/m3).`,
        location: locationFilter,
        timestamp: latestPm25Entry.date,
        metric_value: `${latestPm25Entry.pm25} ug/m3`,
        threshold_ref: stdName,
      });
    }

    // Check latest stored model prediction for this location or overall
    const latestPredRow = (
      locationFilter !== 'All Locations'
        ? db.prepare('SELECT * FROM predictions WHERE location = ? ORDER BY id DESC LIMIT 1').get(locationFilter)
        : db.prepare('SELECT * FROM predictions ORDER BY id DESC LIMIT 1').get()
    ) as Record<string, unknown> | undefined;

    if (latestPredRow) {
      const predVal = Number(latestPredRow.predicted_value);
      if (predVal > threshold) {
        alerts.push({
          id: `alert-pred-${latestPredRow.id}`,
          type: 'prediction',
          severity: predVal > threshold * 1.5 ? 'critical' : 'warning',
          title: 'Model Prediction Alert (Estimated Exceedance)',
          message: `Model estimate for ${latestPredRow.location} (${latestPredRow.observation_date}) is ${predVal} ug/m3, exceeding ${stdName}. Verify against physical sensors.`,
          location: String(latestPredRow.location),
          timestamp: String(latestPredRow.observation_date),
          metric_value: `${predVal} ug/m3 (Model Estimate)`,
          threshold_ref: stdName,
        });
      }
    }

    if (!activeModel) {
      alerts.push({
        id: 'alert-no-model',
        type: 'model_status',
        severity: 'warning',
        title: 'Prediction Model Not Trained',
        message: 'No active regression model is selected. Open Model Laboratory to train a Random Forest Regressor.',
      });
    } else if (scopedRows.length > 0 && scopedRows.length < 14) {
      alerts.push({
        id: 'alert-sparse-window',
        type: 'data_quality',
        severity: 'warning',
        title: 'Narrow Observation Window Selected',
        message: `Only ${scopedRows.length} observation(s) fall within the selected filter range. Expand the date range for stable trend comparison.`,
      });
    }

    // Filter evaluation preview by location if specific location chosen
    const evalPool = activeModel?.evaluation_series ?? [];
    const evalFiltered =
      locationFilter !== 'All Locations'
        ? evalPool.filter((pt) => pt.location === locationFilter)
        : evalPool;

    const summary: DashboardSummaryResponse = {
      dataset,
      active_model: activeModel,
      selected_location: locationFilter,
      selected_standard: standard,
      kpis: {
        latest_pm25: {
          value: latestPm25Entry?.pm25 ?? null,
          date: latestPm25Entry?.date ?? null,
          location: locationFilter,
          sparkline: dailyPm25Series.slice(-20),
        },
        latest_pm10: {
          value: latestPm10Entry?.pm10 ?? null,
          date: latestPm10Entry?.date ?? null,
          location: locationFilter,
          sparkline: dailyPm10Series.slice(-20),
        },
        period_avg_pm25: {
          value: periodAvgPm25,
          start: scopedRows[0]?.date ?? null,
          end: scopedRows[scopedRows.length - 1]?.date ?? null,
          count: rawPm25Vals.length,
          min: minPm25,
          max: maxPm25,
        },
        location_count: locationComparisons.length,
        model_status: {
          ready: Boolean(activeModel),
          version: activeModel?.version ?? null,
          mae: activeModel?.metrics.mae ?? null,
          rmse: activeModel?.metrics.rmse ?? null,
          is_demo: Boolean(activeModel?.is_demo_dataset),
        },
        latest_timestamp: dataset.date_range.end,
      },
      time_series: timeSeries,
      monthly_patterns: monthlyPatterns,
      location_comparisons: locationComparisons,
      evaluation_preview: evalFiltered.slice(-60),
      alerts,
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to compute dashboard summary.',
    });
  }
});

// 3. Datasets List & Upload & Explorer Endpoints
apiRouter.get('/datasets', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM datasets ORDER BY id DESC').all() as Record<string, unknown>[];
    res.json({ datasets: rows.map(mapDatasetRow) });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve datasets.' });
  }
});

apiRouter.post('/datasets/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No CSV file provided in upload payload.' });
      return;
    }

    const originalName = req.file.originalname || 'uploaded_dataset.csv';
    if (!originalName.toLowerCase().endsWith('.csv')) {
      res.status(400).json({ error: 'Unsupported file format. Only UTF-8 .csv files are accepted.' });
      return;
    }

    const csvText = req.file.buffer.toString('utf-8');
    if (csvText.includes('\u0000')) {
      res.status(400).json({ error: 'Binary file detected. Please upload a valid UTF-8 text CSV dataset.' });
      return;
    }

    const targetColumn = typeof req.body?.target_column === 'string' && req.body.target_column.trim()
      ? req.body.target_column.trim()
      : 'pm25';
    const datasetName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim().slice(0, 120)
      : originalName.replace(/\.csv$/i, '');
    const sourceDesc = typeof req.body?.source === 'string' && req.body.source.trim()
      ? req.body.source.trim().slice(0, 200)
      : 'User Uploaded CSV Archive';
    const licenseInfo = typeof req.body?.license_info === 'string' && req.body.license_info.trim()
      ? req.body.license_info.trim().slice(0, 160)
      : 'User Supplied Dataset';
    const isDemo = req.body?.is_demo === 'true' || req.body?.is_demo === true;

    const inspected = inspectCsvContent(csvText, targetColumn);
    if (inspected.validationStatus === 'Invalid') {
      res.status(422).json({
        error: 'Dataset schema validation failed.',
        details: inspected.validationNotes,
      });
      return;
    }

    const safeFile = `${Date.now()}_${sanitizeFilename(originalName)}`;
    const savedPath = path.join(UPLOADS_DIR, safeFile);
    fs.writeFileSync(savedPath, csvText, 'utf-8');

    const nowIso = new Date().toISOString();
    const notes = isDemo
      ? ['DEMO DATA — Illustrative or sample data, not live environmental observations.', ...inspected.validationNotes]
      : inspected.validationNotes;

    const insertRes = db
      .prepare(
        `INSERT INTO datasets (
          name, source, license_info, is_demo, file_path, uploaded_at,
          row_count, column_count, duplicate_count, invalid_numeric_total,
          column_schema, date_range, location_count, locations, missing_pct,
          target_column, feature_columns, validation_status, validation_notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        datasetName,
        sourceDesc,
        licenseInfo,
        isDemo ? 1 : 0,
        savedPath,
        nowIso,
        inspected.rawRowCount,
        inspected.columnCount,
        inspected.duplicateCount,
        inspected.invalidNumericTotal,
        JSON.stringify(inspected.columnSchema),
        JSON.stringify(inspected.dateRange),
        inspected.locations.length,
        JSON.stringify(inspected.locations),
        inspected.missingPct,
        inspected.targetColumn,
        JSON.stringify(inspected.featureColumns),
        inspected.validationStatus,
        JSON.stringify(notes)
      );

    const newRow = db.prepare('SELECT * FROM datasets WHERE id = ?').get(Number(insertRes.lastInsertRowid)) as Record<string, unknown>;
    res.status(201).json({ dataset: mapDatasetRow(newRow) });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to validate and store uploaded CSV dataset.',
    });
  }
});

apiRouter.get('/datasets/:datasetId/summary', (req, res) => {
  const id = Number(req.params.datasetId);
  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Dataset not found.' });
    return;
  }
  res.json({ dataset: mapDatasetRow(row) });
});

apiRouter.get('/datasets/:datasetId/preview', (req, res) => {
  const id = Number(req.params.datasetId);
  const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Dataset not found.' });
    return;
  }
  const observations = loadDatasetObservations(id);
  res.json({
    dataset: mapDatasetRow(row),
    rows: observations.slice(0, limit),
    total_rows: observations.length,
  });
});

apiRouter.get('/datasets/:datasetId/observations', (req, res) => {
  const id = Number(req.params.datasetId);
  const location = typeof req.query.location === 'string' ? req.query.location : '';
  const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : '';
  const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(10, Number(req.query.page_size) || 100));

  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Dataset not found.' });
    return;
  }

  const all = loadDatasetObservations(id);
  const filtered = all.filter((r) => {
    if (location && location !== 'All Locations' && r.location !== location) return false;
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    return true;
  });

  const offset = (page - 1) * pageSize;
  res.json({
    observations: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    page_size: pageSize,
  });
});

apiRouter.get('/datasets/:datasetId/download-cleaned', (req, res) => {
  const id = Number(req.params.datasetId);
  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Dataset not found.' });
    return;
  }
  const dataset = mapDatasetRow(row);
  const observations = loadDatasetObservations(id);
  const csvOut = Papa.unparse(observations);
  const filename = sanitizeFilename(`${dataset.name}_cleaned.csv`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csvOut);
});

apiRouter.delete('/datasets/:datasetId', (req, res) => {
  const id = Number(req.params.datasetId);
  const totalCount = (db.prepare('SELECT COUNT(*) as c FROM datasets').get() as { c: number }).c;
  if (totalCount <= 1) {
    res.status(400).json({ error: 'Cannot delete the last remaining dataset in the workspace.' });
    return;
  }
  const row = db.prepare('SELECT * FROM datasets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) {
    res.status(404).json({ error: 'Dataset not found.' });
    return;
  }
  db.prepare('DELETE FROM datasets WHERE id = ?').run(id);
  // Ensure an active model still exists if its parent dataset was deleted
  const active = getActiveModelRecord();
  if (!active) {
    const fallbackModel = db.prepare('SELECT id FROM model_versions ORDER BY id DESC LIMIT 1').get() as { id: number } | undefined;
    if (fallbackModel) {
      db.prepare('UPDATE model_versions SET is_active = 1 WHERE id = ?').run(fallbackModel.id);
    }
  }
  res.json({ deleted: true, id });
});

// 4. Models & Training Laboratory Endpoints
apiRouter.get('/models', (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT m.*, d.name as dataset_name, d.is_demo as is_demo
         FROM model_versions m
         LEFT JOIN datasets d ON m.dataset_id = d.id
         ORDER BY m.id DESC`
      )
      .all() as Record<string, unknown>[];

    const models = rows.map((r) => {
      const { artifact_path: _unused, ...clean } = mapModelVersionRow(r);
      return clean;
    });
    res.json({ models });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve model versions.' });
  }
});

apiRouter.get('/models/metrics', (req, res) => {
  const modelId = req.query.model_id ? Number(req.query.model_id) : null;
  const record = modelId ? getModelRecordById(modelId) : getActiveModelRecord();
  if (!record) {
    res.status(404).json({ error: 'No trained model version found.' });
    return;
  }
  const { artifact_path: _unused, ...clean } = record;
  res.json({ model: clean });
});

const TrainRequestSchema = z.object({
  dataset_id: z.number().int().positive(),
  model_name: z.string().min(2).max(120).optional(),
  target: z.string().min(1).max(60).default('pm25'),
  features: z.array(z.string().min(1)).min(1, 'Select at least one feature column.'),
  n_estimators: z.number().int().min(10).max(80).default(35),
  max_depth: z.number().int().min(3).max(14).default(8),
  min_samples_leaf: z.number().int().min(2).max(20).default(4),
  train_ratio: z.number().min(0.6).max(0.9).default(0.8),
  activate_immediately: z.boolean().default(false),
});

apiRouter.post('/models/train', (req, res) => {
  const parsed = TrainRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid training configuration.',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  try {
    const cfg = parsed.data;
    const dsRow = db.prepare('SELECT * FROM datasets WHERE id = ?').get(cfg.dataset_id) as Record<string, unknown> | undefined;
    if (!dsRow) {
      res.status(404).json({ error: 'Selected training dataset was not found.' });
      return;
    }
    const dataset = mapDatasetRow(dsRow);
    const rows = loadDatasetObservations(dataset.id);

    const existingCount = (db.prepare('SELECT COUNT(*) as c FROM model_versions').get() as { c: number }).c;
    const nextVersion = `v1.${existingCount}.0`;

    const trained = trainAndSerializeModel({
      rows,
      targetColumn: cfg.target,
      features: cfg.features,
      version: nextVersion,
      modelName: cfg.model_name || `Random Forest ${cfg.target.toUpperCase()} (${dataset.locations.length} stn)`,
      nEstimators: cfg.n_estimators,
      maxDepth: cfg.max_depth,
      minSamplesLeaf: cfg.min_samples_leaf,
      trainRatio: cfg.train_ratio,
      modelsDir: MODELS_DIR,
      isDemoDataset: dataset.is_demo,
    });

    // Never silently overwrite active working model unless explicitly requested or none exists
    const currentActive = getActiveModelRecord();
    const shouldActivate = cfg.activate_immediately || !currentActive;
    if (shouldActivate) {
      db.prepare('UPDATE model_versions SET is_active = 0').run();
    }

    const insertRes = db
      .prepare(
        `INSERT INTO model_versions (
          dataset_id, model_name, version, algorithm, task_type, target, unit,
          features, hyperparameters, training_period, test_period,
          dataset_size, train_size, test_size, metrics, feature_importance,
          feature_bounds, evaluation_series, residual_histogram, limitations,
          artifact_path, created_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        dataset.id,
        trained.artifact.modelName,
        trained.artifact.version,
        trained.artifact.algorithm,
        trained.artifact.taskType,
        trained.artifact.target,
        trained.artifact.unit,
        JSON.stringify(trained.artifact.features),
        JSON.stringify({
          n_estimators: cfg.n_estimators,
          max_depth: cfg.max_depth,
          min_samples_leaf: cfg.min_samples_leaf,
          train_ratio: cfg.train_ratio,
        }),
        JSON.stringify(trained.artifact.trainingPeriod),
        JSON.stringify(trained.artifact.testPeriod),
        trained.artifact.datasetSize,
        trained.artifact.trainSize,
        trained.artifact.testSize,
        JSON.stringify(trained.artifact.metrics),
        JSON.stringify(trained.artifact.featureImportance),
        JSON.stringify(trained.artifact.featureBounds),
        JSON.stringify(trained.evaluationSeries),
        JSON.stringify(trained.residualHistogram),
        JSON.stringify(trained.artifact.limitations),
        trained.artifactPath,
        trained.artifact.createdAt,
        shouldActivate ? 1 : 0
      );

    const newRecord = getModelRecordById(Number(insertRes.lastInsertRowid))!;
    const { artifact_path: _unused, ...clean } = newRecord;
    res.status(201).json({ model: clean });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Model training failed.',
    });
  }
});

apiRouter.post('/models/:modelId/activate', (req, res) => {
  const id = Number(req.params.modelId);
  const record = getModelRecordById(id);
  if (!record) {
    res.status(404).json({ error: 'Model version not found.' });
    return;
  }
  db.prepare('UPDATE model_versions SET is_active = 0').run();
  db.prepare('UPDATE model_versions SET is_active = 1 WHERE id = ?').run(id);
  const updated = getModelRecordById(id)!;
  const { artifact_path: _unused, ...clean } = updated;
  res.json({ model: clean });
});

// 5. Predictions & History
const PredictionSchema = z.object({
  location: z.string().min(1, 'Location is required.').max(120),
  observation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Provide date in YYYY-MM-DD format.'),
  inputs: z.record(z.string(), z.number().nullable()),
  model_version_id: z.number().int().positive().optional(),
  standard: z.enum(['WHO_2021', 'CPCB_NAAQS']).optional(),
});

apiRouter.post('/predictions', (req, res) => {
  const parsed = PredictionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid prediction input payload.',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  try {
    const { location, observation_date, inputs, model_version_id, standard = 'CPCB_NAAQS' } = parsed.data;
    const modelRec = model_version_id ? getModelRecordById(model_version_id) : getActiveModelRecord();
    if (!modelRec) {
      res.status(400).json({ error: 'No trained model is currently active. Train or activate a model in Model Laboratory.' });
      return;
    }

    const artifact = loadModelArtifact(modelRec.artifact_path);
    const inference = runArtifactInference(artifact, inputs, standard);
    const nowIso = new Date().toISOString();

    const insertRes = db
      .prepare(
        `INSERT INTO predictions (
          model_version_id, location, observation_date, input_payload,
          imputed_features, extrapolated_features, predicted_value,
          ensemble_iqr, linear_comparison_value, unit,
          reference_category, warnings, limitations, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        modelRec.id,
        location,
        observation_date,
        JSON.stringify(inputs),
        JSON.stringify(inference.imputedFeatures),
        JSON.stringify(inference.extrapolatedFeatures),
        inference.predictedValue,
        JSON.stringify(inference.ensembleIqr),
        inference.linearComparisonValue,
        artifact.unit,
        JSON.stringify(inference.referenceCategory),
        JSON.stringify(inference.warnings),
        JSON.stringify(artifact.limitations),
        nowIso
      );

    const newId = Number(insertRes.lastInsertRowid);
    res.status(201).json({
      prediction: {
        id: newId,
        model_version_id: modelRec.id,
        model_version: modelRec.version,
        model_name: modelRec.model_name,
        task_type: modelRec.task_type,
        is_demo_model: Boolean(modelRec.is_demo_dataset),
        location,
        observation_date,
        input_payload: inputs,
        imputed_features: inference.imputedFeatures,
        extrapolated_features: inference.extrapolatedFeatures,
        predicted_value: inference.predictedValue,
        ensemble_iqr: inference.ensembleIqr,
        linear_comparison_value: inference.linearComparisonValue,
        unit: artifact.unit,
        reference_category: inference.referenceCategory,
        model_metrics: { mae: modelRec.metrics.mae, rmse: modelRec.metrics.rmse },
        feature_contributions: inference.featureContributions,
        warnings: inference.warnings,
        limitations: artifact.limitations,
        created_at: nowIso,
      },
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Prediction execution failed.',
    });
  }
});

apiRouter.get('/predictions/history', (req, res) => {
  try {
    const location = typeof req.query.location === 'string' ? req.query.location : '';
    const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : '';
    const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : '';

    const rows = db
      .prepare(
        `SELECT p.*, m.version as model_version, m.model_name, m.task_type,
                m.metrics as model_metrics, m.feature_importance as model_feature_importance,
                m.feature_bounds as model_feature_bounds, d.is_demo as is_demo_model
         FROM predictions p
         LEFT JOIN model_versions m ON p.model_version_id = m.id
         LEFT JOIN datasets d ON m.dataset_id = d.id
         ORDER BY p.id DESC LIMIT 200`
      )
      .all() as Record<string, unknown>[];

    const mapped = rows.map(mapPredictionRow).filter((p) => {
      if (location && location !== 'All Locations' && p.location !== location) return false;
      if (startDate && p.observation_date < startDate) return false;
      if (endDate && p.observation_date > endDate) return false;
      return true;
    });

    res.json({ predictions: mapped });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve prediction history.' });
  }
});

// 6. Scenario Lab Endpoints
const ScenarioCompareSchema = z.object({
  name: z.string().max(120).optional(),
  location: z.string().min(1).max(120),
  baseline_inputs: z.record(z.string(), z.number()),
  modified_inputs: z.record(z.string(), z.number()),
  emissions_adjustment_pct: z.number().min(-50).max(50).default(0),
  model_version_id: z.number().int().positive().optional(),
  standard: z.enum(['WHO_2021', 'CPCB_NAAQS']).optional(),
});

function computeScenarioComparison(data: z.infer<typeof ScenarioCompareSchema>): ScenarioComparisonResult {
  const modelRec = data.model_version_id ? getModelRecordById(data.model_version_id) : getActiveModelRecord();
  if (!modelRec) {
    throw new Error('No active trained model available for scenario simulation.');
  }
  const artifact = loadModelArtifact(modelRec.artifact_path);
  const standard = data.standard ?? 'CPCB_NAAQS';

  const baseInf = runArtifactInference(artifact, data.baseline_inputs, standard);
  const modInf = runArtifactInference(artifact, data.modified_inputs, standard);

  // Optional explicitly documented local anthropogenic sensitivity calculation:
  // If user specifies a hypothetical local primary-emission factor adjustment (e.g. -10%),
  // we apply a documented 0.35 local primary PM2.5 sensitivity coefficient on top of the raw ML estimate,
  // while displaying BOTH raw_model_modified_output and the adjusted scenario estimate transparently!
  const localPrimaryFraction = 0.35;
  const emissionFactorMultiplier = 1 + (data.emissions_adjustment_pct / 100) * localPrimaryFraction;
  const finalModifiedOutput = Number(Math.max(0, modInf.predictedValue * emissionFactorMultiplier).toFixed(2));

  const absDiff = Number((finalModifiedOutput - baseInf.predictedValue).toFixed(2));
  const pctDiff =
    baseInf.predictedValue > 0 ? Number((((finalModifiedOutput - baseInf.predictedValue) / baseInf.predictedValue) * 100).toFixed(1)) : 0;

  const parameterDeltas = artifact.features.map((feat) => {
    const bVal = data.baseline_inputs[feat] ?? artifact.imputerMedians[feat] ?? 0;
    const mVal = data.modified_inputs[feat] ?? artifact.imputerMedians[feat] ?? 0;
    const delta = Number((mVal - bVal).toFixed(3));
    const deltaPct = Math.abs(bVal) > 1e-6 ? Number((((mVal - bVal) / Math.abs(bVal)) * 100).toFixed(1)) : 0;
    const bounds = artifact.featureBounds[feat] || { min: 0, max: 100 };
    const outOfBounds = mVal < bounds.min || mVal > bounds.max || bVal < bounds.min || bVal > bounds.max;
    return {
      feature: feat,
      label: getFeatureLabel(feat),
      unit: getFeatureUnit(feat),
      baseline: Number(bVal.toFixed(2)),
      modified: Number(mVal.toFixed(2)),
      delta,
      delta_pct: deltaPct,
      out_of_bounds: outOfBounds,
      training_min: bounds.min,
      training_max: bounds.max,
    };
  });

  const assumptions: string[] = [
    `Scenario estimate evaluated using ${modelRec.model_name} (${modelRec.version}) trained on ${modelRec.training_period.start} to ${modelRec.training_period.end}.`,
    'All unmodified environmental features are held constant (ceteris paribus) between Baseline and Modified inputs.',
    'Outputs represent conditional statistical scenario estimates, not proven causal intervention impacts.',
  ];

  if (data.emissions_adjustment_pct !== 0) {
    assumptions.push(
      `Includes explicit parametric source-apportionment sensitivity (${data.emissions_adjustment_pct > 0 ? '+' : ''}${data.emissions_adjustment_pct}% local primary emissions assuming a 0.35 local primary PM2.5 mass fraction; raw unadjusted ML output = ${modInf.predictedValue} ug/m3).`
    );
  }

  const warnings = Array.from(new Set([...baseInf.warnings, ...modInf.warnings]));
  if (modelRec.is_demo_dataset) {
    warnings.push('Active model was trained on bundled DEMO DATA — Illustrative sample dataset.');
  }

  return {
    name: data.name?.trim() || `${data.location} Scenario Comparison`,
    location: data.location,
    model_version_id: modelRec.id,
    model_version: modelRec.version,
    is_demo_model: Boolean(modelRec.is_demo_dataset),
    baseline_inputs: data.baseline_inputs,
    modified_inputs: data.modified_inputs,
    baseline_output: baseInf.predictedValue,
    modified_output: finalModifiedOutput,
    raw_model_modified_output: modInf.predictedValue,
    emissions_adjustment_pct: data.emissions_adjustment_pct,
    abs_diff: absDiff,
    pct_diff: pctDiff,
    unit: artifact.unit,
    baseline_category: classifyPM25(baseInf.predictedValue, standard).band,
    modified_category: classifyPM25(finalModifiedOutput, standard).band,
    parameter_deltas: parameterDeltas,
    assumptions,
    warnings,
    created_at: new Date().toISOString(),
  };
}

apiRouter.post('/scenarios/compare', (req, res) => {
  const parsed = ScenarioCompareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid scenario parameters.',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }
  try {
    const scenario = computeScenarioComparison(parsed.data);
    res.json({ scenario });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Scenario comparison failed.' });
  }
});

apiRouter.post('/scenarios/save', (req, res) => {
  const parsed = ScenarioCompareSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid scenario save payload.',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }
  try {
    const sc = computeScenarioComparison(parsed.data);
    const insertRes = db
      .prepare(
        `INSERT INTO scenarios (
          name, location, baseline_inputs, modified_inputs,
          baseline_output, modified_output, raw_model_modified_output,
          emissions_adjustment_pct, abs_diff, pct_diff, unit,
          baseline_category, modified_category, parameter_deltas,
          model_version_id, assumptions, warnings, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sc.name,
        sc.location,
        JSON.stringify(sc.baseline_inputs),
        JSON.stringify(sc.modified_inputs),
        sc.baseline_output,
        sc.modified_output,
        sc.raw_model_modified_output,
        sc.emissions_adjustment_pct,
        sc.abs_diff,
        sc.pct_diff,
        sc.unit,
        sc.baseline_category,
        sc.modified_category,
        JSON.stringify(sc.parameter_deltas),
        sc.model_version_id,
        JSON.stringify(sc.assumptions),
        JSON.stringify(sc.warnings),
        sc.created_at
      );

    sc.id = Number(insertRes.lastInsertRowid);
    res.status(201).json({ scenario: sc });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save scenario.' });
  }
});

apiRouter.get('/scenarios', (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT s.*, m.version as model_version, d.is_demo as is_demo_model
         FROM scenarios s
         LEFT JOIN model_versions m ON s.model_version_id = m.id
         LEFT JOIN datasets d ON m.dataset_id = d.id
         ORDER BY s.id DESC LIMIT 100`
      )
      .all() as Record<string, unknown>[];
    res.json({ scenarios: rows.map(mapScenarioRow) });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve saved scenarios.' });
  }
});

apiRouter.delete('/scenarios/:scenarioId', (req, res) => {
  const id = Number(req.params.scenarioId);
  db.prepare('DELETE FROM scenarios WHERE id = ?').run(id);
  res.json({ deleted: true, id });
});

// 7. Rule-Based Recommendations Endpoint
apiRouter.get('/recommendations', (req, res) => {
  try {
    const datasetId = req.query.dataset_id ? Number(req.query.dataset_id) : null;
    const location = typeof req.query.location === 'string' ? req.query.location : 'All Locations';
    const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : '';
    const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : '';
    const standard: AirQualityStandard = req.query.standard === 'WHO_2021' ? 'WHO_2021' : 'CPCB_NAAQS';

    const dsRow = datasetId
      ? (db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId) as Record<string, unknown> | undefined)
      : (db.prepare('SELECT * FROM datasets ORDER BY is_demo ASC, id ASC LIMIT 1').get() as Record<string, unknown> | undefined);

    const dataset = dsRow ? mapDatasetRow(dsRow) : null;
    const allRows = dataset ? loadDatasetObservations(dataset.id) : [];
    const filteredRows = allRows.filter((r) => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      return true;
    });

    const activeModelFull = getActiveModelRecord();
    const activeModel = activeModelFull
      ? (() => {
          const { artifact_path: _unused, ...clean } = activeModelFull;
          return clean;
        })()
      : null;

    const latestPredRow = (
      location !== 'All Locations'
        ? db.prepare('SELECT predicted_value, observation_date FROM predictions WHERE location = ? ORDER BY id DESC LIMIT 1').get(location)
        : db.prepare('SELECT predicted_value, observation_date FROM predictions ORDER BY id DESC LIMIT 1').get()
    ) as { predicted_value: number; observation_date: string } | undefined;

    const recommendations = generateRuleBasedRecommendations({
      dataset,
      rows: filteredRows,
      location,
      activeModel,
      latestPrediction: latestPredRow
        ? { value: Number(latestPredRow.predicted_value), date: String(latestPredRow.observation_date) }
        : null,
      standard,
    });

    res.json({ recommendations, dataset_is_demo: Boolean(dataset?.is_demo) });
  } catch {
    res.status(500).json({ error: 'Failed to generate rule-based recommendations.' });
  }
});

// 8. Report Generation & History
const ReportGenerateSchema = z.object({
  report_name: z.string().min(2).max(140),
  report_type: z.enum(['PDF_SUMMARY', 'CSV_EXPORT']).default('PDF_SUMMARY'),
  dataset_id: z.number().int().positive().optional(),
  location: z.string().default('All Locations'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  standard: z.enum(['WHO_2021', 'CPCB_NAAQS']).default('CPCB_NAAQS'),
});

apiRouter.post('/reports/generate', (req, res) => {
  const parsed = ReportGenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid report request parameters.' });
    return;
  }

  try {
    const { report_name, report_type, dataset_id, location, start_date, end_date, standard } = parsed.data;
    const dsRow = dataset_id
      ? (db.prepare('SELECT * FROM datasets WHERE id = ?').get(dataset_id) as Record<string, unknown> | undefined)
      : (db.prepare('SELECT * FROM datasets ORDER BY is_demo ASC, id ASC LIMIT 1').get() as Record<string, unknown> | undefined);

    if (!dsRow) {
      res.status(404).json({ error: 'No dataset available to generate report.' });
      return;
    }

    const dataset = mapDatasetRow(dsRow);
    const allRows = loadDatasetObservations(dataset.id);
    const scopedRows = allRows.filter((r) => {
      if (location && location !== 'All Locations' && r.location !== location) return false;
      if (start_date && r.date < start_date) return false;
      if (end_date && r.date > end_date) return false;
      return true;
    });

    const pm25Vals = scopedRows.map((r) => r.pm25).filter((v): v is number => typeof v === 'number');
    const pm10Vals = scopedRows.map((r) => r.pm10).filter((v): v is number => typeof v === 'number');
    const no2Vals = scopedRows.map((r) => r.no2).filter((v): v is number => typeof v === 'number');

    const activeModelFull = getActiveModelRecord();
    const activeModel = activeModelFull
      ? (() => {
          const { artifact_path: _unused, ...clean } = activeModelFull;
          return clean;
        })()
      : null;

    const predictionsRows = db
      .prepare(
        `SELECT p.*, m.version as model_version, m.model_name, m.task_type,
                m.metrics as model_metrics, d.is_demo as is_demo_model
         FROM predictions p
         LEFT JOIN model_versions m ON p.model_version_id = m.id
         LEFT JOIN datasets d ON m.dataset_id = d.id
         ORDER BY p.id DESC LIMIT 15`
      )
      .all() as Record<string, unknown>[];

    const scenariosRows = db
      .prepare(
        `SELECT s.*, m.version as model_version, d.is_demo as is_demo_model
         FROM scenarios s
         LEFT JOIN model_versions m ON s.model_version_id = m.id
         LEFT JOIN datasets d ON m.dataset_id = d.id
         ORDER BY s.id DESC LIMIT 10`
      )
      .all() as Record<string, unknown>[];

    const recommendations = generateRuleBasedRecommendations({
      dataset,
      rows: scopedRows,
      location,
      activeModel,
      standard,
    });

    const dateRange = {
      start: start_date || scopedRows[0]?.date || dataset.date_range.start || 'N/A',
      end: end_date || scopedRows[scopedRows.length - 1]?.date || dataset.date_range.end || 'N/A',
    };

    const summaryPayload = {
      dataset_name: dataset.name,
      is_demo: dataset.is_demo,
      observation_count: scopedRows.length,
      mean_pm25: avgOf(pm25Vals),
      max_pm25: pm25Vals.length > 0 ? Math.max(...pm25Vals) : null,
      mean_pm10: avgOf(pm10Vals),
      mean_no2: avgOf(no2Vals),
      model_version: activeModel?.version ?? null,
      model_mae: activeModel?.metrics.mae ?? null,
      model_rmse: activeModel?.metrics.rmse ?? null,
      recommendations_count: recommendations.length,
    };

    const nowIso = new Date().toISOString();
    const reportArtifactFile = path.join(REPORTS_DIR, `report_${Date.now()}.json`);
    const fullBundle = {
      report_name,
      report_type,
      generated_at: nowIso,
      location,
      standard,
      date_range: dateRange,
      dataset,
      summary_statistics: summaryPayload,
      recent_observations: scopedRows.slice(-40),
      active_model: activeModel,
      predictions: predictionsRows.map(mapPredictionRow),
      scenarios: scenariosRows.map(mapScenarioRow),
      recommendations,
      disclaimer:
        'Decision-support academic synthesis generated by EcoTwin AI. Does not constitute an official regulatory compliance audit or medical advisory.',
    };

    fs.writeFileSync(reportArtifactFile, JSON.stringify(fullBundle, null, 2), 'utf-8');

    const insertRes = db
      .prepare(
        `INSERT INTO reports (
          report_name, report_type, location, date_range, summary_payload, created_at, file_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        report_name,
        report_type,
        location,
        JSON.stringify(dateRange),
        JSON.stringify(summaryPayload),
        nowIso,
        reportArtifactFile
      );

    res.status(201).json({
      report: {
        id: Number(insertRes.lastInsertRowid),
        report_name,
        report_type,
        location,
        date_range: dateRange,
        summary_payload: summaryPayload,
        created_at: nowIso,
      },
      bundle: fullBundle,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate environmental report.',
    });
  }
});

apiRouter.get('/reports', (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 50').all() as Record<string, unknown>[];
    res.json({ reports: rows.map(mapReportRow) });
  } catch {
    res.status(500).json({ error: 'Failed to retrieve generated reports.' });
  }
});
