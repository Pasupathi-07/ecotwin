import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Download, FileUp, Trash2 } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { api } from '../lib/api';
import type { ObservationRow } from '../types/ecotwin';
import { ConfirmDialog, ErrorBanner, EvidenceLabel, FeedbackNotice } from '../components/Primitives';

const columnHelper = createColumnHelper<ObservationRow>();

export function DatasetExplorerPage() {
  const {
    datasets,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedDataset,
    refreshMetadata,
    settings,
  } = useWorkspace();

  // Client-side upload preview states
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [clientPreviewHeaders, setClientPreviewHeaders] = useState<string[]>([]);
  const [clientPreviewRows, setClientPreviewRows] = useState<Record<string, string>[]>([]);
  const [uploadName, setUploadName] = useState('');
  const [uploadSource, setUploadSource] = useState('');
  const [uploadLicense, setUploadLicense] = useState('Open Monitoring Data');
  const [uploadTarget, setUploadTarget] = useState('pm25');
  const [uploadIsDemo, setUploadIsDemo] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Observation table states
  const [obsRows, setObsRows] = useState<ObservationRow[]>([]);
  const [totalObs, setTotalObs] = useState(0);
  const [page, setPage] = useState(1);
  const [stationFilter, setStationFilter] = useState('All Locations');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [loadingRows, setLoadingRows] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);

  const pageSize = 25;

  const loadObservations = useCallback(async () => {
    if (!selectedDatasetId) return;
    setLoadingRows(true);
    try {
      const res = await api.getDatasetObservations({
        datasetId: selectedDatasetId,
        location: stationFilter !== 'All Locations' ? stationFilter : undefined,
        page,
        page_size: pageSize,
      });
      setObsRows(res.observations);
      setTotalObs(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dataset observations.');
    } finally {
      setLoadingRows(false);
    }
  }, [selectedDatasetId, stationFilter, page]);

  useEffect(() => {
    setPage(1);
  }, [selectedDatasetId, stationFilter]);

  useEffect(() => {
    void loadObservations();
  }, [loadObservations]);

  const handleFileSelection = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setError(null);
    if (!file) {
      setUploadFile(null);
      setClientPreviewHeaders([]);
      setClientPreviewRows([]);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only UTF-8 .csv files are supported.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('CSV file exceeds the 10 MB upload limit.');
      return;
    }

    setUploadFile(file);
    setUploadName(file.name.replace(/\.csv$/i, ''));

    // Client-side CSV preview using PapaParse
    Papa.parse<Record<string, string>>(file, {
      header: true,
      preview: 6,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields || [];
        setClientPreviewHeaders(fields);
        setClientPreviewRows(results.data || []);
        const pmCol = fields.find((f) => f.toLowerCase().includes('pm25') || f.toLowerCase().includes('pm2.5'));
        if (pmCol) setUploadTarget(pmCol);
      },
      error: (err) => {
        setError(`CSV preview failed: ${err.message}`);
      },
    });
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('name', uploadName || uploadFile.name);
      formData.append('source', uploadSource || 'Uploaded Station CSV');
      formData.append('license_info', uploadLicense);
      formData.append('target_column', uploadTarget);
      formData.append('is_demo', String(uploadIsDemo));

      const res = await api.uploadDataset(formData);
      await refreshMetadata();
      setSelectedDatasetId(res.dataset.id);
      setUploadFile(null);
      setClientPreviewHeaders([]);
      setClientPreviewRows([]);
      setNotice(`Uploaded and validated "${res.dataset.name}" (${res.dataset.row_count} cleaned records).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload validation failed.');
    } finally {
      setUploading(false);
    }
  };

  const tableColumns = useMemo(
    () => [
      columnHelper.accessor('date', {
        header: 'Date',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
      }),
      columnHelper.accessor('location', {
        header: 'Location',
        cell: (info) => <span className="font-medium text-[var(--text-primary)]">{info.getValue()}</span>,
      }),
      columnHelper.accessor('pm25', {
        header: 'PM2.5',
        cell: (info) => (
          <span className="font-mono tabular-nums text-[var(--accent-teal)]">
            {info.getValue() ?? '—'}
          </span>
        ),
      }),
      columnHelper.accessor('pm10', {
        header: 'PM10',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.accessor('no2', {
        header: 'NO2',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.accessor('so2', {
        header: 'SO2',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.accessor('temperature_c', {
        header: 'Temp (°C)',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.accessor('humidity_pct', {
        header: 'RH (%)',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
      columnHelper.accessor('wind_speed_ms', {
        header: 'Wind (m/s)',
        cell: (info) => <span className="font-mono tabular-nums">{info.getValue() ?? '—'}</span>,
      }),
    ],
    []
  );

  const table = useReactTable({
    data: obsRows,
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const totalPages = Math.max(1, Math.ceil(totalObs / pageSize));

  return (
    <div className="space-y-6">
      {error && <ErrorBanner message={error} />}
      {notice && <FeedbackNotice variant="success" title="Dataset Updated" message={notice} onDismiss={() => setNotice(null)} />}

      {/* Registered Datasets Inventory & Upload Form */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Registered Datasets & Active Schema */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Registered Datasets ({datasets.length})
            </h2>

            <div className="space-y-2.5">
              {datasets.map((ds) => {
                const isSelected = ds.id === selectedDatasetId;
                return (
                  <div
                    key={ds.id}
                    onClick={() => setSelectedDatasetId(ds.id)}
                    className={`p-3.5 rounded-md border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--bg-elevated)] border-[var(--accent-teal)]'
                        : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]/60'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-[var(--text-primary)]">{ds.name}</span>
                          <EvidenceLabel origin={ds.is_demo ? 'Demonstration data' : 'Observed'} />
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                          Source: {ds.source} · License: {ds.license_info}
                        </p>
                      </div>

                      {datasets.length > 1 && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setDeleteTargetId(ds.id);
                          }}
                          aria-label={`Delete dataset ${ds.name}`}
                          className="p-1 text-[var(--text-secondary)] hover:text-[var(--accent-red)] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-[var(--text-secondary)]">
                      <span>{ds.row_count} rows</span>
                      <span aria-hidden="true">·</span>
                      <span>{ds.column_count} cols</span>
                      <span aria-hidden="true">·</span>
                      <span>{ds.location_count} station(s)</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {ds.date_range.start} to {ds.date_range.end}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Missing: {ds.missing_pct}%</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          ds.validation_status === 'Valid'
                            ? 'text-[var(--accent-teal)]'
                            : 'text-[var(--accent-amber)]'
                        }
                      >
                        {ds.validation_status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Dataset Quality Diagnostics */}
          {selectedDataset && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    Schema & Summary Statistics — {selectedDataset.name}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    Target: <span className="font-mono">{selectedDataset.target_column}</span> · Duplicates removed: {selectedDataset.duplicate_count} · Invalid numerics nullified: {selectedDataset.invalid_numeric_total}
                  </p>
                </div>

                <a
                  href={api.getCleanedDatasetDownloadUrl(selectedDataset.id)}
                  download
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bg-elevated)] border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-[var(--accent-teal)] whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[var(--accent-teal)]" />
                  Download Cleaned CSV
                </a>
              </div>

              {selectedDataset.validation_notes.length > 0 && (
                <div className="p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-subtle)] space-y-1">
                  {selectedDataset.validation_notes.map((note, idx) => (
                    <p key={idx} className="text-xs text-[var(--text-secondary)]">
                      • {note}
                    </p>
                  ))}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                      <th className="py-2 px-2">Column</th>
                      <th className="py-2 px-2">Type</th>
                      <th className="py-2 px-2 text-right">Missing</th>
                      <th className="py-2 px-2 text-right">Min</th>
                      <th className="py-2 px-2 text-right">Median</th>
                      <th className="py-2 px-2 text-right">Mean</th>
                      <th className="py-2 px-2 text-right">Max</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] font-mono tabular-nums">
                    {selectedDataset.column_schema.map((col) => (
                      <tr key={col.name}>
                        <td className="py-2 px-2 text-[var(--text-primary)]">{col.name}</td>
                        <td className="py-2 px-2 text-[var(--text-secondary)]">{col.dtype}</td>
                        <td className="py-2 px-2 text-right text-[var(--text-secondary)]">
                          {col.missing_count} ({col.missing_pct}%)
                        </td>
                        <td className="py-2 px-2 text-right">{col.min ?? '—'}</td>
                        <td className="py-2 px-2 text-right">{col.median ?? '—'}</td>
                        <td className="py-2 px-2 text-right">{col.mean ?? '—'}</td>
                        <td className="py-2 px-2 text-right">{col.max ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right 5 cols: CSV Upload & Client-Side Preview */}
        <form
          onSubmit={handleUploadSubmit}
          className="lg:col-span-5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4"
        >
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Ingest New Environmental CSV Dataset
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Expected columns: <span className="font-mono">date</span>, <span className="font-mono">location</span>, <span className="font-mono">pm25</span>, plus meteorology/co-pollutants (max 10 MB)
            </p>
          </div>

          <div>
            <label htmlFor="csv-file-input" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Select UTF-8 CSV File
            </label>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileSelection}
              className="w-full text-xs text-[var(--text-secondary)] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[var(--border-subtle)] file:bg-[var(--bg-elevated)] file:text-[var(--text-primary)] file:cursor-pointer"
            />
          </div>

          {clientPreviewHeaders.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="up-name" className="block text-xs text-[var(--text-secondary)] mb-1">
                    Dataset Name
                  </label>
                  <input
                    id="up-name"
                    type="text"
                    required
                    value={uploadName}
                    onChange={(e) => setUploadName(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label htmlFor="up-target" className="block text-xs text-[var(--text-secondary)] mb-1">
                    Target Column
                  </label>
                  <select
                    id="up-target"
                    value={uploadTarget}
                    onChange={(e) => setUploadTarget(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)]"
                  >
                    {clientPreviewHeaders.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="up-source" className="block text-xs text-[var(--text-secondary)] mb-1">
                    Data Source / Agency
                  </label>
                  <input
                    id="up-source"
                    type="text"
                    placeholder="e.g., CPCB CAAQMS / OpenAQ"
                    value={uploadSource}
                    onChange={(e) => setUploadSource(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label htmlFor="up-license" className="block text-xs text-[var(--text-secondary)] mb-1">
                    License / Citation
                  </label>
                  <input
                    id="up-license"
                    type="text"
                    value={uploadLicense}
                    onChange={(e) => setUploadLicense(e.target.value)}
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={uploadIsDemo}
                  onChange={(e) => setUploadIsDemo(e.target.checked)}
                  className="accent-[#2DD4BF]"
                />
                Mark as synthetic / demonstration sample data
              </label>

              {/* Client-side Instant Row Preview */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  Client-Side Preview (First {clientPreviewRows.length} rows)
                </span>
                <div className="overflow-x-auto border border-[var(--border-subtle)] rounded bg-[var(--bg-secondary)]">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)]">
                        {clientPreviewHeaders.slice(0, 6).map((h) => (
                          <th key={h} className="py-1.5 px-2 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {clientPreviewRows.map((r, rIdx) => (
                        <tr key={rIdx}>
                          {clientPreviewHeaders.slice(0, 6).map((h) => (
                            <td key={h} className="py-1 px-2 whitespace-nowrap">
                              {r[h] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <button
                type="submit"
                disabled={uploading}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-md text-xs font-semibold bg-[var(--accent-teal)] text-[#0B1220] hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                <FileUp className="w-4 h-4" />
                {uploading ? 'Validating & Importing...' : 'Validate & Store Dataset'}
              </button>
            </>
          )}
        </form>
      </div>

      {/* TanStack Observation Data Table */}
      <section className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Cleaned Observation Records ({totalObs} rows)
            </h2>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Click column headers to sort current page · Paginated to maintain fast browser responsiveness
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <select
              aria-label="Filter observations by station"
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
            >
              <option value="All Locations">All Stations</option>
              {(selectedDataset?.locations || []).map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-[var(--border-subtle)] text-[var(--text-secondary)] font-mono">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      onClick={header.column.getToggleSortingHandler()}
                      className="py-2.5 px-2.5 cursor-pointer select-none hover:text-[var(--text-primary)] whitespace-nowrap"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: ' ▲', desc: ' ▼' }[header.column.getIsSorted() as string] ?? ''}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {loadingRows ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center font-mono text-[var(--text-secondary)]">
                    Loading observation records...
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`hover:bg-[var(--bg-elevated)]/40 ${settings.compactTables ? 'h-8' : 'h-10'}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2.5 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)] text-xs font-mono text-[var(--text-secondary)]">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border-subtle)] disabled:opacity-40 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[var(--border-subtle)] disabled:opacity-40 cursor-pointer"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Delete Dataset Archive?"
        description="Deleting a dataset also removes model versions trained exclusively on it. This action cannot be undone."
        confirmLabel="Delete Dataset"
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={async () => {
          if (deleteTargetId !== null) {
            try {
              await api.deleteDataset(deleteTargetId);
              await refreshMetadata();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Unable to delete dataset.');
            } finally {
              setDeleteTargetId(null);
            }
          }
        }}
      />
    </div>
  );
}
