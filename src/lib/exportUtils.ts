import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import Papa from 'papaparse';
import type {
  DatasetRecord,
  ModelVersionRecord,
  ObservationRow,
  PredictionRecord,
  RecommendationItem,
  ScenarioComparisonResult,
} from '../types/ecotwin';

export function triggerCsvDownload(filename: string, rows: Record<string, unknown>[]): void {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportEnvironmentalReportPdf(bundle: {
  report_name: string;
  generated_at: string;
  location: string;
  standard: string;
  date_range: { start: string; end: string };
  dataset: DatasetRecord;
  summary_statistics: {
    dataset_name: string;
    is_demo: boolean;
    observation_count: number;
    mean_pm25: number | null;
    max_pm25: number | null;
    mean_pm10: number | null;
    mean_no2: number | null;
    model_version: string | null;
    model_mae: number | null;
    model_rmse: number | null;
    recommendations_count: number;
  };
  recent_observations: ObservationRow[];
  active_model: ModelVersionRecord | null;
  predictions: PredictionRecord[];
  scenarios: ScenarioComparisonResult[];
  recommendations: RecommendationItem[];
  disclaimer: string;
}): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = 16;

  // Header Banner
  doc.setFillColor(11, 18, 32);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(45, 212, 191);
  doc.setFontSize(9);
  doc.text('ECOTWIN AI — ENVIRONMENTAL RISK PREDICTION & DECISION SUPPORT SYSTEM', 14, 12);
  doc.setTextColor(241, 245, 249);
  doc.setFontSize(15);
  doc.text(bundle.report_name, 14, 21);
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8.5);
  doc.text(
    `Generated: ${bundle.generated_at.slice(0, 19).replace('T', ' ')} UTC  |  Scope: ${bundle.location}  |  Period: ${bundle.date_range.start} to ${bundle.date_range.end}`,
    14,
    27.5
  );

  y = 40;
  doc.setTextColor(15, 23, 42);

  // Section 1-3: Dataset Provenance & Limitations
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('1. Dataset Source, Scope & Provenance', 14, y);
  y += 5;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const provLines = doc.splitTextToSize(
    `Dataset: ${bundle.dataset.name}\nSource: ${bundle.dataset.source}\nLicense: ${bundle.dataset.license_info}\nData Origin Flag: ${
      bundle.dataset.is_demo
        ? 'DEMO DATA — Illustrative or sample data, not live environmental observations.'
        : 'User-Uploaded CSV Monitoring Dataset'
    }\nValidation Status: ${bundle.dataset.validation_status} (Missing cells: ${bundle.dataset.missing_pct}%)`,
    182
  );
  doc.text(provLines, 14, y);
  y += provLines.length * 4.5 + 4;

  // Section 4-5: Summary Statistics & Historical Environmental Trends
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('2. Historical Summary Statistics', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Indicator', 'Value', 'Unit', 'Origin / Standard Context']],
    body: [
      ['Observation Count', String(bundle.summary_statistics.observation_count), 'records', `${bundle.date_range.start} to ${bundle.date_range.end}`],
      ['Period Mean PM2.5', bundle.summary_statistics.mean_pm25 !== null ? String(bundle.summary_statistics.mean_pm25) : 'Unavailable', 'ug/m3', bundle.dataset.is_demo ? 'Demo Historical' : 'Observed Historical'],
      ['Period Max PM2.5', bundle.summary_statistics.max_pm25 !== null ? String(bundle.summary_statistics.max_pm25) : 'Unavailable', 'ug/m3', `Ref Standard: ${bundle.standard}`],
      ['Period Mean PM10', bundle.summary_statistics.mean_pm10 !== null ? String(bundle.summary_statistics.mean_pm10) : 'Unavailable', 'ug/m3', 'Coarse Particulate'],
      ['Period Mean NO2', bundle.summary_statistics.mean_no2 !== null ? String(bundle.summary_statistics.mean_no2) : 'Unavailable', 'ug/m3', 'Combustion Precursor'],
    ],
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 2.2 },
    headStyles: { fillColor: [23, 38, 58], textColor: [241, 245, 249] },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 7;

  // Section 6-7: Prediction Target, Model Information & Evaluation Metrics
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('3. Machine-Learning Model & Held-Out Evaluation Metrics', 14, y);
  y += 3;

  if (bundle.active_model) {
    const m = bundle.active_model;
    autoTable(doc, {
      startY: y,
      head: [['Model Property', 'Recorded Value']],
      body: [
        ['Model Name & Version', `${m.model_name} (${m.version}) — ${m.algorithm}`],
        ['Prediction Task & Target', `${m.task_type} -> ${m.target.toUpperCase()} (${m.unit})`],
        ['Chronological Split', `Train: ${m.training_period.start}..${m.training_period.end} (${m.train_size} rows) | Test: ${m.test_period.start}..${m.test_period.end} (${m.test_size} rows)`],
        ['Input Features', m.features.join(', ')],
        ['Random Forest Test MAE / RMSE', `MAE = ${m.metrics.mae} ug/m3  |  RMSE = ${m.metrics.rmse} ug/m3  |  R2 = ${m.metrics.r2}`],
        ['Linear Baseline Test MAE / RMSE', `MAE = ${m.metrics.linear_baseline_mae} ug/m3  |  RMSE = ${m.metrics.linear_baseline_rmse} ug/m3 (${m.metrics.improvement_vs_linear_pct}% MAE gain)`],
      ],
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [23, 38, 58], textColor: [241, 245, 249] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 7;
  } else {
    y += 3;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('No active trained machine-learning model was selected at report generation time.', 14, y);
    y += 7;
  }

  // Section 8: Selected Prediction Results
  if (bundle.predictions.length > 0) {
    if (y > 235) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('4. Recent Model Prediction Estimates (Not Physical Measurements)', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['Date', 'Location', 'Model Estimate', 'Ensemble IQR', 'Model Version', 'Reference Category']],
      body: bundle.predictions.slice(0, 6).map((p) => [
        p.observation_date,
        p.location,
        `${p.predicted_value} ${p.unit}`,
        `${p.ensemble_iqr.p25} - ${p.ensemble_iqr.p75}`,
        p.model_version,
        p.reference_category.band,
      ]),
      theme: 'grid',
      styles: { fontSize: 7.8, cellPadding: 2 },
      headStyles: { fillColor: [23, 38, 58], textColor: [241, 245, 249] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 7;
  }

  // Section 9: Baseline-vs-Scenario Comparison
  if (bundle.scenarios.length > 0) {
    if (y > 235) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('5. Hypothetical Scenario Comparisons (Scenario Estimates)', 14, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      head: [['Scenario Name', 'Location', 'Baseline Est.', 'Scenario Est.', 'Difference', 'Model']],
      body: bundle.scenarios.slice(0, 5).map((s) => [
        s.name,
        s.location,
        `${s.baseline_output} ${s.unit}`,
        `${s.modified_output} ${s.unit}`,
        `${s.abs_diff > 0 ? '+' : ''}${s.abs_diff} ${s.unit} (${s.pct_diff > 0 ? '+' : ''}${s.pct_diff}%)`,
        s.model_version,
      ]),
      theme: 'grid',
      styles: { fontSize: 7.8, cellPadding: 2 },
      headStyles: { fillColor: [23, 38, 58], textColor: [241, 245, 249] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 7;
  }

  // Section 10: Evidence-Linked Recommendations
  if (y > 220) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('6. Rule-Based Environmental Recommendations', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Priority', 'Title & Issue', 'Supporting Evidence', 'Suggested Action & Rule']],
    body: bundle.recommendations.map((r) => [
      r.priority,
      `${r.title}\n(${r.environmental_issue})`,
      `[${r.evidence_origin}] ${r.supporting_data}`,
      `${r.suggested_action}\nRef: ${r.rule_reference}`,
    ]),
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2 },
    headStyles: { fillColor: [23, 38, 58], textColor: [241, 245, 249] },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 7;

  // Section 11-12: Assumptions, Limitations & References
  if (y > 240) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(10.5);
  doc.setFont('helvetica', 'bold');
  doc.text('7. Assumptions, Scientific Limitations & References', 14, y);
  y += 5;
  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'normal');
  const limText = [
    ...(bundle.active_model?.limitations || []),
    'References: (1) WHO Global Air Quality Guidelines (2021) — 24-hr PM2.5 reference 15 ug/m3; (2) CPCB National Ambient Air Quality Standards (NAAQS, India) — 24-hr PM2.5 threshold 60 ug/m3, PM10 threshold 100 ug/m3.',
    `Disclaimer: ${bundle.disclaimer}`,
  ].join('\n• ');
  const splitLim = doc.splitTextToSize(`• ${limText}`, 182);
  doc.text(splitLim, 14, y);

  const safeName = bundle.report_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  doc.save(`${safeName}_ecotwin_report.pdf`);
}
