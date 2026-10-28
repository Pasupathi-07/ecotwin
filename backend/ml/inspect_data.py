"""Dataset inspection and data-quality validation module for EcoTwin AI."""
from __future__ import annotations

from pathlib import Path
from typing import Any
import numpy as np
import pandas as pd


COLUMN_ALIASES = {
    "pm2.5": "pm25",
    "pm2_5": "pm25",
    "timestamp": "date",
    "datetime": "date",
    "station": "location",
    "city": "location",
    "lat": "latitude",
    "lon": "longitude",
    "lng": "longitude",
    "temp": "temperature_c",
    "temperature": "temperature_c",
    "humidity": "humidity_pct",
    "wind_speed": "wind_speed_ms",
    "rainfall": "rainfall_mm",
    "ndvi": "green_index_ndvi",
}


def load_and_inspect_csv(csv_path: str | Path, target_col: str = "pm25") -> dict[str, Any]:
    df = pd.read_csv(csv_path)
    df.columns = [COLUMN_ALIASES.get(c.strip().lower().replace(" ", "_"), c.strip().lower().replace(" ", "_")) for c in df.columns]

    notes: list[str] = []
    if "date" not in df.columns:
        raise ValueError("Missing required 'date' column in CSV dataset.")
    if target_col not in df.columns:
        raise ValueError(f"Missing target column '{target_col}' in CSV dataset.")

    if "location" not in df.columns:
        df["location"] = "Default Monitoring Station"

    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    df = df.dropna(subset=["date"])

    before_dedup = len(df)
    df = df.drop_duplicates(subset=["date", "location"], keep="first")
    duplicates_removed = before_dedup - len(df)
    if duplicates_removed > 0:
        notes.append(f"Removed {duplicates_removed} duplicate station-date records.")

    df = df.sort_values(["date", "location"]).reset_index(drop=True)

    invalid_numeric = 0
    for col in df.columns:
        if col in {"date", "location", "station_code"}:
            continue
        coerced = pd.to_numeric(df[col], errors="coerce")
        if col in {"pm25", "pm10", "no2", "so2", "co", "o3", "wind_speed_ms", "rainfall_mm"}:
            neg_mask = coerced < 0
            invalid_numeric += int(neg_mask.sum())
            coerced = coerced.mask(neg_mask, np.nan)
        df[col] = coerced

    missing_pct = round(float(df.isna().sum().sum()) / max(1, df.size) * 100.0, 2)
    excluded = {"date", "location", "station_code", "latitude", "longitude", target_col}
    features = [c for c in df.select_dtypes(include=[np.number]).columns if c not in excluded]

    return {
        "dataframe": df,
        "row_count": len(df),
        "column_count": len(df.columns),
        "duplicate_count": duplicates_removed,
        "invalid_numeric_count": invalid_numeric,
        "missing_pct": missing_pct,
        "date_range": {"start": str(df["date"].min()), "end": str(df["date"].max())},
        "locations": sorted(df["location"].unique().tolist()),
        "target_column": target_col,
        "feature_columns": features,
        "notes": notes,
    }


if __name__ == "__main__":
    sample_csv = Path(__file__).resolve().parents[2] / "data" / "datasets" / "demo_regional_air_quality_2025_2026.csv"
    if sample_csv.exists():
        summary = load_and_inspect_csv(sample_csv)
        print(f"Inspected {summary['row_count']} rows across {len(summary['locations'])} stations.")
        print(f"Date range: {summary['date_range']['start']} -> {summary['date_range']['end']}")
        print(f"Features: {summary['feature_columns']}")
