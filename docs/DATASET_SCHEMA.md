# EcoTwin AI — Dataset Schema Specification

EcoTwin AI ingests UTF-8 encoded `.csv` files containing historical environmental station observations.

## 1. Required & Recommended Columns

| Column Name | Alias Accepted | Data Type | Unit | Required | Physical Constraint |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `date` | `timestamp`, `datetime`, `observed_at` | ISO Date (`YYYY-MM-DD`) | UTC / Local Date | **Yes** | Valid calendar date |
| `location` | `station`, `city`, `site` | Categorical String | — | Recommended | Station identifier |
| `pm25` | `pm2.5`, `pm2_5` | Numeric Float | `ug/m3` | **Yes** (Default Target) | `>= 0` |
| `pm10` | — | Numeric Float | `ug/m3` | Optional | `>= 0` |
| `no2` | — | Numeric Float | `ug/m3` | Optional | `>= 0` |
| `so2` | — | Numeric Float | `ug/m3` | Optional | `>= 0` |
| `co` | — | Numeric Float | `mg/m3` | Optional | `>= 0` |
| `o3` | — | Numeric Float | `ug/m3` | Optional | `>= 0` |
| `temperature_c` | `temp`, `temperature` | Numeric Float | `deg C` | Optional | `[-40, 60]` |
| `humidity_pct` | `humidity` | Numeric Float | `%` | Optional | `[0, 100]` |
| `wind_speed_ms` | `wind_speed` | Numeric Float | `m/s` | Optional | `>= 0` |
| `rainfall_mm` | `rainfall` | Numeric Float | `mm` | Optional | `>= 0` |
| `green_index_ndvi` | `ndvi` | Numeric Float | Index | Optional | `[-1.0, 1.0]` |
| `latitude` | `lat` | Numeric Float | Decimal Degrees | Optional | `[-90, 90]` |
| `longitude` | `lon`, `lng` | Numeric Float | Decimal Degrees | Optional | `[-180, 180]` |

## 2. Example CSV Snippet

```csv
date,location,station_code,latitude,longitude,pm25,pm10,no2,so2,co,o3,temperature_c,humidity_pct,wind_speed_ms,rainfall_mm,green_index_ndvi
2026-01-15,Chennai - Alandur,TN-CHN-01,13.0025,80.2060,41.2,74.8,31.5,9.8,1.12,38.4,26.8,75.0,3.10,0.0,0.275
2026-01-16,Chennai - Alandur,TN-CHN-01,13.0025,80.2060,38.6,69.5,28.9,9.2,1.04,40.1,27.1,73.5,3.65,1.2,0.279
```

## 3. Geospatial Coordinate Handling

- Records containing valid `latitude` and `longitude` values are plotted directly on the Environmental Twin map.
- If `latitude`/`longitude` are omitted, EcoTwin AI checks its documented station registry (`server/stations.ts`).
- If no coordinate match exists, the geographical map layer disables cleanly rather than fabricating coordinates.
