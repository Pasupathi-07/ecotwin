import type {
  AirQualityStandard,
  DatasetRecord,
  ModelVersionRecord,
  ObservationRow,
  RecommendationItem,
} from '../src/types/ecotwin.ts';
import { resolveStationMetadata } from './stations.ts';

export function generateRuleBasedRecommendations(params: {
  dataset: DatasetRecord | null;
  rows: ObservationRow[];
  location: string;
  activeModel: ModelVersionRecord | null;
  latestPrediction?: { value: number; date: string } | null;
  standard?: AirQualityStandard;
}): RecommendationItem[] {
  const { dataset, rows, location, activeModel, latestPrediction, standard = 'CPCB_NAAQS' } = params;
  const recommendations: RecommendationItem[] = [];

  if (!dataset || rows.length === 0) {
    recommendations.push({
      id: 'rec-no-data',
      title: 'Establish Baseline Monitoring Dataset Before Operational Advisories',
      domain: 'Monitoring & QA/QC',
      environmental_issue: 'No valid historical observations available for the selected location and filter window.',
      supporting_data: 'Observation count = 0 rows.',
      evidence_origin: 'Unavailable',
      reason: 'Rule-based thresholds and regression estimators require verified station measurements before evaluating exposure or emission trends.',
      suggested_action: 'Upload a validated station CSV dataset or broaden the selected date/location filter to restore baseline coverage.',
      priority: 'High',
      evidence_strength: 'Direct Data-Completeness Rule (100% deterministic)',
      rule_reference: 'EcoTwin QA/QC Rule DQ-01: Minimum Sample Sufficiency',
      location: location || 'All Locations',
    });
    return recommendations;
  }

  const originLabel = dataset.is_demo ? 'Demonstration data' : 'Observed';
  const filtered = location && location !== 'All Locations' ? rows.filter((r) => r.location === location) : rows;
  const scopeLabel = location && location !== 'All Locations' ? location : `Network Aggregate (${dataset.location_count} stations)`;

  if (filtered.length === 0) {
    recommendations.push({
      id: 'rec-empty-filter',
      title: 'Broaden Temporal or Station Filter Scope',
      domain: 'Monitoring & QA/QC',
      environmental_issue: `Zero records matched "${scopeLabel}" in the current date window.`,
      supporting_data: `Dataset "${dataset.name}" spans ${dataset.date_range.start} to ${dataset.date_range.end}.`,
      evidence_origin: 'Unavailable',
      reason: 'Environmental indicators cannot be evaluated when filter bounds exclude all recorded dates.',
      suggested_action: 'Reset date filters to overlap with the dataset coverage period.',
      priority: 'Informational',
      evidence_strength: 'Deterministic Filter Check',
      rule_reference: 'EcoTwin QA/QC Rule DQ-02: Temporal Coverage Alignment',
      location: scopeLabel,
    });
    return recommendations;
  }

  // Data quality & missingness assessment
  const pm25Vals = filtered.map((r) => r.pm25).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const pm10Vals = filtered.map((r) => r.pm10).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const no2Vals = filtered.map((r) => r.no2).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const windVals = filtered.map((r) => r.wind_speed_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const ndviVals = filtered.map((r) => r.green_index_ndvi).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const missingPm25Pct = Number((((filtered.length - pm25Vals.length) / filtered.length) * 100).toFixed(1));
  if (dataset.is_demo) {
    recommendations.push({
      id: 'rec-demo-notice',
      title: 'Replace Demonstration Archive With Regulatory Station Observations',
      domain: 'Monitoring & QA/QC',
      environmental_issue: 'Active workspace uses bundled illustrative demonstration data rather than verified regulatory sensor feeds.',
      supporting_data: `Dataset: "${dataset.name}" (${dataset.row_count} rows, source: ${dataset.source}).`,
      evidence_origin: 'Demonstration data',
      reason: 'Bundled sample datasets validate software pipelines and model mechanics, but policy or regulatory decisions require certified reference-grade measurements (e.g., CPCB CAAQMS / OpenAQ).',
      suggested_action: 'Import calibrated station CSV archives in Dataset Explorer and retrain a dedicated model version before citing findings externally.',
      priority: 'Informational',
      evidence_strength: 'Provenance Governance Rule',
      rule_reference: 'EcoTwin Provenance Standard PR-01',
      location: scopeLabel,
    });
  }

  if (missingPm25Pct > 5 || dataset.missing_pct > 5 || filtered.length < 30) {
    recommendations.push({
      id: 'rec-data-gaps',
      title: 'Audit Sensor Completeness and Calibrate Data Gaps',
      domain: 'Monitoring & QA/QC',
      environmental_issue:
        filtered.length < 30
          ? `Limited observation window (${filtered.length} records) restricts seasonal representativeness.`
          : `Missing data rate (${Math.max(missingPm25Pct, dataset.missing_pct)}%) exceeds the 5% completeness target.`,
      supporting_data: `${pm25Vals.length}/${filtered.length} valid PM2.5 observations; overall dataset missingness = ${dataset.missing_pct}%.`,
      evidence_origin: originLabel,
      reason: 'High missingness or short time windows can bias period averages if outages coincide with high-pollution stagnation episodes.',
      suggested_action: 'Verify analyzer maintenance logs, inspect missing timestamps in Dataset Explorer, and collect contiguous multi-season records before drawing long-term trend conclusions.',
      priority: missingPm25Pct > 15 ? 'High' : 'Moderate',
      evidence_strength: 'Direct Completeness Audit',
      rule_reference: 'CPCB / US EPA 75%–95% Data Completeness Guideline (Rule DQ-03)',
      location: scopeLabel,
    });
  }

  if (pm25Vals.length > 0) {
    const meanPm25 = pm25Vals.reduce((a, b) => a + b, 0) / pm25Vals.length;
    const latestRow = [...filtered].reverse().find((r) => typeof r.pm25 === 'number');
    const latestPm25 = latestRow?.pm25 ?? meanPm25;
    const threshold = standard === 'WHO_2021' ? 15.0 : 60.0;
    const standardLabel = standard === 'WHO_2021' ? 'WHO 2021 24-hr Guideline (15 ug/m3)' : 'CPCB NAAQS 24-hr Standard (60 ug/m3)';
    const exceedCount = pm25Vals.filter((v) => v > threshold).length;
    const exceedPct = Number(((exceedCount / pm25Vals.length) * 100).toFixed(1));
    const stationMeta = resolveStationMetadata(location);

    // Rule AQ-01: Elevated PM2.5 threshold exceedance
    if (meanPm25 > threshold || exceedPct >= 25) {
      const priority = meanPm25 > threshold * 1.4 || exceedPct > 50 ? 'Critical' : 'High';
      const zoneHint = stationMeta?.zone_type
        ? `Station classification is "${stationMeta.zone_type}".`
        : 'Review local land-use and receptor classification.';

      recommendations.push({
        id: 'rec-pm25-exceedance',
        title: 'Investigate Local Fine-Particulate Emission Sources and Exceedance Episodes',
        domain: 'Air Quality',
        environmental_issue: `Observed PM2.5 exceeds the ${standardLabel} on ${exceedCount} of ${pm25Vals.length} recorded days (${exceedPct}%).`,
        supporting_data: `Period mean PM2.5 = ${meanPm25.toFixed(1)} ug/m3; latest observed = ${latestPm25.toFixed(1)} ug/m3 (${latestRow?.date ?? 'N/A'}). ${zoneHint}`,
        evidence_origin: originLabel,
        reason: 'Sustained 24-hour fine-particulate exceedances indicate persistent primary combustion or secondary aerosol accumulation rather than isolated transient spikes.',
        suggested_action: 'Conduct source-apportionment review across corridor traffic volumes, industrial stack schedules, and open biomass/waste burning, and cross-check co-located reference monitors.',
        priority,
        evidence_strength: `Empirical Threshold Rule (${pm25Vals.length} observations evaluated)`,
        rule_reference: `${standardLabel} — Rule AQ-01`,
        location: scopeLabel,
      });
    } else if (meanPm25 > 15 && standard === 'CPCB_NAAQS') {
      recommendations.push({
        id: 'rec-pm25-who-gap',
        title: 'Maintain NAAQS Margin While Tracking WHO Interim Targets',
        domain: 'Air Quality',
        environmental_issue: `Period mean PM2.5 (${meanPm25.toFixed(1)} ug/m3) remains within CPCB 24-hr NAAQS (60 ug/m3) but exceeds the stricter WHO 2021 24-hr reference (15 ug/m3).`,
        supporting_data: `Mean PM2.5 = ${meanPm25.toFixed(1)} ug/m3 across ${pm25Vals.length} days; NAAQS exceedance rate = ${exceedPct}%.`,
        evidence_origin: originLabel,
        reason: 'Tracking secondary international benchmarks helps identify gradual baseline drift before national regulatory thresholds are breached.',
        suggested_action: 'Continue routine multi-pollutant monitoring and evaluate seasonal peaks during low-wind winter months.',
        priority: 'Moderate',
        evidence_strength: 'Dual-Standard Benchmark Comparison',
        rule_reference: 'CPCB NAAQS (60 ug/m3) & WHO 2021 IT-3 (37.5 ug/m3) — Rule AQ-02',
        location: scopeLabel,
      });
    }

    // Rule AQ-03: Fine-to-Coarse Ratio (PM2.5 / PM10) diagnostic
    if (pm10Vals.length >= 10) {
      const paired = filtered.filter((r) => typeof r.pm25 === 'number' && typeof r.pm10 === 'number' && (r.pm10 as number) > 0);
      if (paired.length >= 10) {
        const avgRatio = paired.reduce((acc, r) => acc + (r.pm25 as number) / (r.pm10 as number), 0) / paired.length;
        const meanNo2 = no2Vals.length > 0 ? no2Vals.reduce((a, b) => a + b, 0) / no2Vals.length : null;

        if (avgRatio >= 0.56) {
          recommendations.push({
            id: 'rec-combustion-signature',
            title: 'Evaluate Combustion and Traffic NOx Precursor Contributions',
            domain: 'Air Quality',
            environmental_issue: `Elevated PM2.5/PM10 mass fraction (${avgRatio.toFixed(2)}) indicates fine combustion aerosols dominate over coarse mineral dust.`,
            supporting_data: `Mean PM2.5/PM10 ratio = ${avgRatio.toFixed(2)}${meanNo2 !== null ? `; mean NO2 = ${meanNo2.toFixed(1)} ug/m3` : ''} (${paired.length} paired days).`,
            evidence_origin: originLabel,
            reason: 'Fine-to-coarse ratios above 0.55 typically reflect vehicular exhaust, diesel generators, or secondary nitrate/sulfate formation rather than mechanical dust resuspension.',
            suggested_action: 'Review peak-hour corridor traffic counts, fleet emission controls, and stationary fuel combustion permits near the monitoring zone.',
            priority: meanPm25 > threshold ? 'High' : 'Moderate',
            evidence_strength: 'Particulate Mass-Fraction Diagnostic',
            rule_reference: 'Atmospheric Aerosol Ratio Diagnostic (PM2.5/PM10 > 0.55) — Rule AQ-03A',
            location: scopeLabel,
          });
        } else if (avgRatio <= 0.45 && pm10Vals.reduce((a, b) => a + b, 0) / pm10Vals.length > 85) {
          const meanPm10 = pm10Vals.reduce((a, b) => a + b, 0) / pm10Vals.length;
          recommendations.push({
            id: 'rec-coarse-dust-signature',
            title: 'Inspect Coarse Dust Resuspension and Construction Fugitive Sources',
            domain: 'Air Quality',
            environmental_issue: `High coarse PM10 (${meanPm10.toFixed(1)} ug/m3) paired with lower PM2.5/PM10 ratio (${avgRatio.toFixed(2)}) points to mechanical dust loading.`,
            supporting_data: `Mean PM10 = ${meanPm10.toFixed(1)} ug/m3; PM2.5/PM10 ratio = ${avgRatio.toFixed(2)} across ${paired.length} paired records.`,
            evidence_origin: originLabel,
            reason: 'Coarse-mode dominance (PM2.5/PM10 <= 0.45) is characteristic of unpaved road dust, construction earthworks, or industrial material handling.',
            suggested_action: 'Verify municipal road-sweeping schedules, construction dust-suppression barriers, and aggregate transport covering in the station catchment.',
            priority: meanPm10 > 100 ? 'High' : 'Moderate',
            evidence_strength: 'Coarse Particulate Fraction Rule',
            rule_reference: 'CPCB NAAQS 24-hr PM10 (100 ug/m3) & Ratio Diagnostic — Rule AQ-03B',
            location: scopeLabel,
          });
        }
      }
    }

    // Rule MET-01: Atmospheric stagnation & low dispersion
    if (windVals.length >= 10) {
      const lowWindDays = filtered.filter((r) => typeof r.wind_speed_ms === 'number' && (r.wind_speed_ms as number) < 2.2);
      const lowWindPct = (lowWindDays.length / windVals.length) * 100;
      if (lowWindPct >= 30) {
        const lowWindPm25 = lowWindDays
          .map((r) => r.pm25)
          .filter((v): v is number => typeof v === 'number');
        const stagMean = lowWindPm25.length > 0 ? lowWindPm25.reduce((a, b) => a + b, 0) / lowWindPm25.length : meanPm25;

        recommendations.push({
          id: 'rec-stagnation-dispersion',
          title: 'Account for Meteorological Stagnation During Low-Wind Periods',
          domain: 'Meteorology & Dispersion',
          environmental_issue: `Low surface wind speed (< 2.2 m/s) occurred on ${lowWindDays.length} days (${lowWindPct.toFixed(0)}%), limiting horizontal pollutant dispersion.`,
          supporting_data: `Mean PM2.5 during low-wind days = ${stagMean.toFixed(1)} ug/m3 vs overall mean = ${meanPm25.toFixed(1)} ug/m3.`,
          evidence_origin: originLabel,
          reason: 'Weak boundary-layer ventilation traps local emissions near the surface, amplifying ambient concentrations even when emission rates remain constant.',
          suggested_action: 'Incorporate wind-speed and temperature-inversion forecasts into short-term operational advisories and use Scenario Lab to test meteorological sensitivity.',
          priority: stagMean > threshold ? 'High' : 'Moderate',
          evidence_strength: 'Meteorological Stratification Check',
          rule_reference: 'EcoTwin Ventilation & Stagnation Rule MET-01',
          location: scopeLabel,
        });
      }
    }
  }

  // Rule VEG-01: Vegetation / NDVI extension check
  if (ndviVals.length >= 15) {
    const firstHalf = ndviVals.slice(0, Math.floor(ndviVals.length / 2));
    const secondHalf = ndviVals.slice(Math.floor(ndviVals.length / 2));
    const meanFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const meanSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const deltaNdvi = meanSecond - meanFirst;

    if (meanSecond < 0.27 || deltaNdvi < -0.025) {
      recommendations.push({
        id: 'rec-vegetation-ndvi',
        title: 'Verify Peri-Urban Green-Cover Buffer With Multi-Spectral Imagery',
        domain: 'Vegetation & Land Cover',
        environmental_issue:
          deltaNdvi < -0.025
            ? `Observed greenness index (NDVI) shifted by ${deltaNdvi.toFixed(3)} between early and late period halves.`
            : `Low mean NDVI (${meanSecond.toFixed(3)}) indicates sparse vegetative cover around the monitoring corridor.`,
        supporting_data: `Early-period NDVI = ${meanFirst.toFixed(3)}; recent-period NDVI = ${meanSecond.toFixed(3)} (${ndviVals.length} records).`,
        evidence_origin: originLabel,
        reason: 'Sparse or declining vegetation correlates with higher surface heating and exposed soil dust, though NDVI changes alone do not prove causal PM2.5 reductions.',
        suggested_action: 'Cross-verify land-cover trends using cloud-free Sentinel-2 / Landsat imagery and ground surveys before attributing air-quality shifts to canopy changes.',
        priority: 'Informational',
        evidence_strength: 'Auxiliary Land-Cover Indicator (Correlational)',
        rule_reference: 'EcoTwin Vegetation Module Rule VEG-01',
        location: scopeLabel,
      });
    }
  }

  // Rule ML-01: Active Model Evaluation & Prediction Context
  if (!activeModel) {
    recommendations.push({
      id: 'rec-model-missing',
      title: 'Train and Validate a Baseline + Random Forest Model Version',
      domain: 'Model Governance',
      environmental_issue: 'No active machine-learning model is currently selected for PM2.5 estimation.',
      supporting_data: 'Active model version = None.',
      evidence_origin: 'Unavailable',
      reason: 'Scenario comparisons and AI estimates require a chronologically validated regression pipeline fitted to compatible dataset features.',
      suggested_action: 'Open Model Laboratory to train and evaluate a Random Forest Regressor against a chronological held-out split.',
      priority: 'Moderate',
      evidence_strength: 'Pipeline Readiness Check',
      rule_reference: 'EcoTwin Model Governance Rule ML-01',
      location: scopeLabel,
    });
  } else {
    const threshold = standard === 'WHO_2021' ? 15.0 : 60.0;
    if (latestPrediction && latestPrediction.value > threshold) {
      recommendations.push({
        id: 'rec-model-pred-alert',
        title: 'Confirm Elevated Model PM2.5 Estimate Against Physical Monitoring',
        domain: 'Model Governance',
        environmental_issue: `Recent model estimate (${latestPrediction.value.toFixed(1)} ug/m3) exceeds the configured reference threshold (${threshold} ug/m3).`,
        supporting_data: `Model ${activeModel.version} (${activeModel.algorithm}) held-out MAE = ${activeModel.metrics.mae} ug/m3, RMSE = ${activeModel.metrics.rmse} ug/m3.`,
        evidence_origin: 'Model prediction',
        reason: 'Statistical model estimates reflect historical input correlations with documented residual error (+/- MAE) and are not direct physical measurements.',
        suggested_action: 'Treat this model output as a decision-support screening estimate and confirm ambient concentrations with calibrated reference analyzers.',
        priority: 'Moderate',
        evidence_strength: `Held-Out Validation (RMSE = ${activeModel.metrics.rmse} ug/m3)`,
        rule_reference: 'EcoTwin Model Transparency Rule ML-02',
        location: scopeLabel,
      });
    }
  }

  return recommendations;
}
