"""Chronological preprocessing and lag-feature engineering without target leakage."""
from __future__ import annotations

from typing import Any
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


def create_chronological_features(df: pd.DataFrame, target_col: str = "pm25") -> pd.DataFrame:
    df_sorted = df.sort_values(["location", "date"]).copy()
    df_sorted["pm25_lag1"] = df_sorted.groupby("location")[target_col].shift(1)
    # Sort globally by date ascending for chronological train/test splitting
    return df_sorted.sort_values(["date", "location"]).reset_index(drop=True)


def chronological_train_test_split(
    df: pd.DataFrame,
    target_col: str,
    features: list[str],
    train_ratio: float = 0.8,
) -> dict[str, Any]:
    enriched = create_chronological_features(df, target_col)
    required_non_null = [target_col] + (["pm25_lag1"] if "pm25_lag1" in features else [])
    valid = enriched.dropna(subset=required_non_null).reset_index(drop=True)

    if len(valid) < 15:
        raise ValueError(f"Insufficient valid chronological observations ({len(valid)} rows).")

    unique_dates = sorted(valid["date"].unique().tolist())
    cutoff_idx = max(1, min(len(unique_dates) - 2, int(len(unique_dates) * train_ratio)))
    cutoff_date = unique_dates[cutoff_idx]

    train_df = valid[valid["date"] < cutoff_date].copy()
    test_df = valid[valid["date"] >= cutoff_date].copy()

    usable_features = [f for f in features if f in train_df.columns and train_df[f].notna().any()]
    if not usable_features:
        raise ValueError("No valid numeric features found in the training split.")

    bounds = {}
    for feat in usable_features:
        col_vals = train_df[feat].dropna()
        bounds[feat] = {
            "min": round(float(col_vals.min()), 3),
            "median": round(float(col_vals.median()), 3),
            "mean": round(float(col_vals.mean()), 3),
            "max": round(float(col_vals.max()), 3),
        }

    preprocessor = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )

    return {
        "features": usable_features,
        "preprocessor": preprocessor,
        "train_df": train_df,
        "test_df": test_df,
        "feature_bounds": bounds,
        "training_period": {"start": str(train_df["date"].min()), "end": str(train_df["date"].max())},
        "test_period": {"start": str(test_df["date"].min()), "end": str(test_df["date"].max())},
    }
