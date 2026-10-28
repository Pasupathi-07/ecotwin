import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { AirQualityStandard, LocationSummaryItem } from '../types/ecotwin';

interface EnvironmentalMapProps {
  stations: LocationSummaryItem[];
  selectedLocation: string;
  onSelectStation: (location: string) => void;
  metricMode: 'latest_pm25' | 'avg_pm25' | 'latest_pm10' | 'avg_no2' | 'model_estimate_pm25';
  showHeatmapPlume: boolean;
  standard: AirQualityStandard;
  theme: 'dark' | 'light';
}

function getMarkerColor(value: number | null, metricMode: EnvironmentalMapProps['metricMode'], standard: AirQualityStandard): string {
  if (value === null || !Number.isFinite(value)) return '#64748B';

  if (metricMode === 'latest_pm10') {
    if (value <= 50) return '#2DD4BF';
    if (value <= 100) return '#A3E635';
    if (value <= 150) return '#FBBF24';
    return '#F87171';
  }

  if (metricMode === 'avg_no2') {
    if (value <= 25) return '#2DD4BF';
    if (value <= 40) return '#A3E635';
    if (value <= 60) return '#FBBF24';
    return '#F87171';
  }

  // PM2.5 modes
  if (standard === 'WHO_2021') {
    if (value <= 15) return '#2DD4BF';
    if (value <= 37.5) return '#A3E635';
    if (value <= 75) return '#FBBF24';
    return '#F87171';
  }

  if (value <= 30) return '#2DD4BF';
  if (value <= 60) return '#A3E635';
  if (value <= 90) return '#FBBF24';
  return '#F87171';
}

export function EnvironmentalMap({
  stations,
  selectedLocation,
  onSelectStation,
  metricMode,
  showHeatmapPlume,
  standard,
  theme,
}: EnvironmentalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const [tileError, setTileError] = useState(false);

  const geoStations = stations.filter(
    (s): s is LocationSummaryItem & { latitude: number; longitude: number } =>
      typeof s.latitude === 'number' &&
      typeof s.longitude === 'number' &&
      Number.isFinite(s.latitude) &&
      Number.isFinite(s.longitude)
  );

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [18.5, 78.2],
      zoom: 5,
      zoomControl: true,
      attributionControl: true,
    });

    const markersGroup = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    markersLayerRef.current = markersGroup;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // Update base map tiles on theme switch (free CARTO OpenStreetMap tiles, no API key required)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl =
      theme === 'light'
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    const layer = L.tileLayer(tileUrl, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    });

    layer.on('tileerror', () => {
      setTileError(true);
    });
    layer.on('load', () => {
      setTileError(false);
    });

    layer.addTo(map);
    tileLayerRef.current = layer;
  }, [theme]);

  // Render station markers and optional dispersion halo overlay
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = markersLayerRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    for (const st of geoStations) {
      const val = st[metricMode];
      const color = getMarkerColor(val, metricMode, standard);
      const isSelected = selectedLocation === st.location;

      if (showHeatmapPlume && val !== null && Number.isFinite(val)) {
        // Proportional radial dispersion halo
        const plumeRadiusMeters = Math.min(135000, Math.max(35000, val * 1150));
        L.circle([st.latitude, st.longitude], {
          radius: plumeRadiusMeters,
          color: color,
          weight: 0,
          fillColor: color,
          fillOpacity: 0.18,
          interactive: false,
        }).addTo(layerGroup);
      }

      const radiusPx = isSelected ? 12 : 9;
      const marker = L.circleMarker([st.latitude, st.longitude], {
        radius: radiusPx,
        color: isSelected ? '#F1F5F9' : '#0B1220',
        weight: isSelected ? 2.5 : 1.5,
        fillColor: color,
        fillOpacity: 0.92,
      });

      const formattedVal = val !== null && Number.isFinite(val) ? `${val.toFixed(1)} ug/m3` : 'Unavailable';
      const metricTitle =
        metricMode === 'model_estimate_pm25'
          ? 'Model Estimate PM2.5'
          : metricMode === 'avg_pm25'
            ? 'Period Mean PM2.5'
            : metricMode === 'latest_pm10'
              ? 'Latest PM10'
              : metricMode === 'avg_no2'
                ? 'Mean NO2'
                : 'Latest PM2.5';

      marker.bindTooltip(
        `<div style="font-family: monospace; font-size: 11px; line-height: 1.4;">
          <strong>${st.location}</strong><br/>
          ${metricTitle}: <strong>${formattedVal}</strong><br/>
          Date: ${st.latest_date || 'N/A'}
        </div>`,
        { direction: 'top', offset: [0, -6] }
      );

      marker.on('click', () => {
        onSelectStation(st.location);
      });

      marker.addTo(layerGroup);
    }

    // Pan/zoom smoothly to selected station or fit bounds
    const activeSt = geoStations.find((s) => s.location === selectedLocation);
    if (activeSt) {
      map.flyTo([activeSt.latitude, activeSt.longitude], Math.max(map.getZoom(), 7), {
        duration: 0.5,
      });
    } else if (geoStations.length > 1) {
      const bounds = L.latLngBounds(geoStations.map((s) => [s.latitude, s.longitude]));
      map.fitBounds(bounds.pad(0.22), { animate: false });
    } else if (geoStations.length === 1) {
      map.setView([geoStations[0].latitude, geoStations[0].longitude], 9);
    }
  }, [geoStations, selectedLocation, metricMode, showHeatmapPlume, standard, onSelectStation]);

  if (geoStations.length === 0) {
    return (
      <div className="h-[520px] w-full rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col items-center justify-center p-6 text-center">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Geographical Layer Disabled for Current Dataset
        </p>
        <p className="text-xs text-[var(--text-secondary)] max-w-md mt-2 leading-relaxed">
          None of the records in the active dataset include valid latitude/longitude coordinates or match a documented station code in the lookup registry. EcoTwin AI never fabricates arbitrary map coordinates.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-[540px] w-full rounded-lg overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-primary)]">
      <div ref={mapContainerRef} className="h-full w-full z-0" />

      {tileError && (
        <div className="absolute top-3 left-14 z-[400] bg-[var(--bg-secondary)]/90 border border-[var(--border-subtle)] rounded px-2.5 py-1 text-[11px] font-mono text-[var(--text-secondary)]">
          External map tiles unreachable · Displaying coordinate vector markers
        </div>
      )}

      {/* Compact Floating Threshold Legend */}
      <div className="absolute bottom-6 left-3 z-[400] bg-[var(--bg-secondary)]/95 border border-[var(--border-subtle)] rounded-md p-3 text-[11px] font-mono shadow-lg max-w-[230px]">
        <div className="font-semibold text-[var(--text-primary)] mb-1.5">
          {metricMode === 'latest_pm10'
            ? 'PM10 Thresholds (ug/m3)'
            : metricMode === 'avg_no2'
              ? 'NO2 Thresholds (ug/m3)'
              : standard === 'WHO_2021'
                ? 'PM2.5 WHO 2021 Bands'
                : 'PM2.5 CPCB NAAQS Bands'}
        </div>
        <div className="space-y-1 text-[var(--text-secondary)]">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2DD4BF]" />
              Low / Good
            </span>
            <span>
              {metricMode === 'latest_pm10'
                ? '<= 50'
                : metricMode === 'avg_no2'
                  ? '<= 25'
                  : standard === 'WHO_2021'
                    ? '<= 15'
                    : '<= 30'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#A3E635]" />
              Satisfactory
            </span>
            <span>
              {metricMode === 'latest_pm10'
                ? '51 - 100'
                : metricMode === 'avg_no2'
                  ? '26 - 40'
                  : standard === 'WHO_2021'
                    ? '15 - 37.5'
                    : '31 - 60'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FBBF24]" />
              Elevated
            </span>
            <span>
              {metricMode === 'latest_pm10'
                ? '101 - 150'
                : metricMode === 'avg_no2'
                  ? '41 - 60'
                  : standard === 'WHO_2021'
                    ? '37.5 - 75'
                    : '61 - 90'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F87171]" />
              High Risk
            </span>
            <span>
              {metricMode === 'latest_pm10'
                ? '> 150'
                : metricMode === 'avg_no2'
                  ? '> 60'
                  : standard === 'WHO_2021'
                    ? '> 75'
                    : '> 90'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
