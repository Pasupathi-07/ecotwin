"""Regression evaluation utilities (MAE, RMSE, R2, and permutation importance)."""
from __future__ import annotations

from typing import Any
import numpy as np
from sklearn.inspection import permutation_importance
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def evaluate_regression_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    return {
        "mae": round(mae, 3),
        "rmse": round(rmse, 3),
        "r2": round(r2, 4),
    }


def compute_explainability(
    rf_pipeline: Any,
    X_test_df: Any,
    y_test: np.ndarray,
    features: list[str],
) -> list[dict[str, Any]]:
    rf_step = rf_pipeline.named_steps["regressor"]
    impurity = rf_step.feature_importances_
    perm = permutation_importance(
        rf_pipeline,
        X_test_df,
        y_test,
        scoring="neg_mean_absolute_error",
        n_repeats=5,
        random_state=42,
    )

    items = []
    for idx, feat in enumerate(features):
        items.append(
            {
                "feature": feat,
                "impurity_importance": round(float(impurity[idx]), 4),
                "permutation_importance_mae": round(max(0.0, float(perm.importances_mean[idx])), 4),
            }
        )
    items.sort(key=lambda x: x["permutation_importance_mae"], reverse=True)
    return items
