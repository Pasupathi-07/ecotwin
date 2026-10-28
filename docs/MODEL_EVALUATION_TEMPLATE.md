# EcoTwin AI — Model Evaluation Report Template

Use this template when documenting newly trained regression model versions in academic submissions.

---

## 1. Model Identification

- **Model Name:** `EcoTwin Random Forest PM2.5 Regressor`
- **Model Version:** `v1.X.0`
- **Algorithm:** `RandomForestRegressor (CART Ensemble)`
- **Prediction Task Type:** `[ ] Next-Step Lagged Forecast (uses t-1 PM2.5)` / `[ ] Contemporaneous Estimate`
- **Target Variable & Unit:** `pm25 (ug/m3)`
- **Training Timestamp (UTC):** `YYYY-MM-DDTHH:MM:SSZ`

## 2. Dataset & Chronological Split Summary

- **Dataset Name & Source:** `________________________________________`
- **Provenance Status:** `[ ] Certified Monitoring Archive` / `[ ] DEMO DATA (Illustrative Sample)`
- **Chronological Training Window:** `YYYY-MM-DD` to `YYYY-MM-DD` (`N = ____` rows)
- **Chronological Held-Out Test Window:** `YYYY-MM-DD` to `YYYY-MM-DD` (`N = ____` rows)
- **Imputation Strategy:** Median imputation fitted strictly on training split (`X_train`)

## 3. Held-Out Test Metrics (Regression)

*Note: Regression models are evaluated via error metrics in physical units (`ug/m3`), never fabricated classification accuracy percentages.*

| Model / Baseline | Held-Out MAE (`ug/m3`) | Held-Out RMSE (`ug/m3`) | R² | Relative MAE Change |
| :--- | :---: | :---: | :---: | :---: |
| Training Mean Baseline | | | | — |
| Lag-1 Persistence (`y_{t-1}`) | | | | |
| Ridge Linear Regression | | | | |
| **Random Forest Candidate** | | | | |

## 4. Top Predictive Features (Held-Out Permutation Importance)

1. `____________________` (`+____ ug/m3` MAE when permuted)
2. `____________________` (`+____ ug/m3` MAE when permuted)
3. `____________________` (`+____ ug/m3` MAE when permuted)

## 5. Known Scientific & Statistical Limitations

- Random Forest ensembles cannot extrapolate linearly outside the observed training domain `[min, max]` of each predictor.
- Model outputs represent statistical estimates conditional on supplied inputs, not direct regulatory sensor measurements.
- Scenario perturbations estimate conditional statistical associations (`Scenario Estimate`) rather than proven causal policy outcomes.
