import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

FRED_API_KEY = os.environ["FRED_API_KEY"]
BLS_API_KEY = os.environ["BLS_API_KEY"]

OUTPUT_PATH = Path("data/market/latest.json")
OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations"
BLS_TIMESERIES_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

BLS_LABOR_SERIES = "CES0500000003"

def is_number(value) -> bool:
    try:
        f = float(value)
        return math.isfinite(f)
    except Exception:
        return False

def to_float(value):
    return float(value) if is_number(value) else None

def pct_change(current, previous):
    if current is None or previous is None or previous == 0:
        return None
    return ((current - previous) / previous) * 100.0

def point_change(current, previous):
    if current is None or previous is None:
        return None
    return current - previous

def round_or_none(value, digits=1):
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)

def fred_observations(series_id: str, limit: int = 24):
    params = {
        "series_id": series_id,
        "api_key": FRED_API_KEY,
        "file_type": "json",
        "sort_order": "desc",
        "limit": limit,
    }
    resp = requests.get(FRED_OBSERVATIONS_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    obs = []
    for row in data.get("observations", []):
        value = to_float(row.get("value"))
        if value is None:
            continue
        obs.append({"date": row.get("date"), "value": value})
    return obs

def latest_and_12mo_ago_fred(series_id: str):
    obs = fred_observations(series_id, limit=18)
    if not obs:
        raise ValueError(f"No FRED observations for {series_id}")
    current = obs[0]["value"]
    twelve_ago = obs[12]["value"] if len(obs) > 12 else obs[-1]["value"]
    return current, twelve_ago

def latest_and_12mo_ago_daily_fred(series_id: str):
    obs = fred_observations(series_id, limit=450)
    if not obs:
        raise ValueError(f"No FRED observations for {series_id}")

    current_date = datetime.strptime(obs[0]["date"], "%Y-%m-%d").date()
    current_value = obs[0]["value"]

    best_match = None
    best_gap = None

    for row in obs[1:]:
        row_date = datetime.strptime(row["date"], "%Y-%m-%d").date()
        day_gap = abs((current_date - row_date).days - 365)

        if best_gap is None or day_gap < best_gap:
            best_gap = day_gap
            best_match = row

    if best_match is None:
        raise ValueError(f"No 12-month comparison observation found for {series_id}")

    return current_value, best_match["value"]

def bls_series_data(series_id: str):
    current_year = datetime.now(timezone.utc).year
    payload = {
        "seriesid": [series_id],
        "startyear": str(current_year - 2),
        "endyear": str(current_year),
        "registrationkey": BLS_API_KEY,
    }
    resp = requests.post(BLS_TIMESERIES_URL, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    results = data.get("Results", {}).get("series", [])
    if not results:
        raise ValueError(f"No BLS data returned for {series_id}")
    rows = []
    for row in results[0].get("data", []):
        period = row.get("period", "")
        if not period.startswith("M") or period == "M13":
            continue
        value = to_float(row.get("value"))
        if value is None:
            continue
        year = int(row["year"])
        month = int(period[1:])
        rows.append({"year": year, "month": month, "value": value})
    rows.sort(key=lambda x: (x["year"], x["month"]), reverse=True)
    if not rows:
        raise ValueError(f"No usable monthly BLS rows for {series_id}")
    current = rows[0]["value"]
    twelve_ago = rows[12]["value"] if len(rows) > 12 else rows[-1]["value"]
    return current, twelve_ago

def build_snapshot():
    cpi_current, cpi_prev12 = latest_and_12mo_ago_fred("CPIAUCSL")
    ppi_current, ppi_prev12 = latest_and_12mo_ago_fred("PPIFIS")
    rates_current, rates_prev12 = latest_and_12mo_ago_fred("FEDFUNDS")
    m2_current, m2_prev12 = latest_and_12mo_ago_fred("M2SL")
    fuel_current, fuel_prev12 = latest_and_12mo_ago_daily_fred("DCOILWTICO")
    sentiment_current, sentiment_prev12 = latest_and_12mo_ago_fred("UMCSENT")
    labor_current, labor_prev12 = bls_series_data(BLS_LABOR_SERIES)

    indicators = [
        {
            "series": "CPIAUCSL",
            "name": "Customer Inflation (CPI)",
            "current": round_or_none(cpi_current, 1),
            "change": round_or_none(pct_change(cpi_current, cpi_prev12), 1),
            "unit": "% YoY",
            "cadence": "year-over-year",
            "impact": "CPI shows what consumers are already absorbing, which helps owners judge customer purchasing pressure.",
            "source": "FRED",
        },
        {
            "series": "PPIFIS",
            "name": "Producer Cost Pressure (PPI — Services)",
            "current": round_or_none(ppi_current, 1),
            "change": round_or_none(pct_change(ppi_current, ppi_prev12), 1),
            "unit": "% YoY",
            "cadence": "year-over-year",
            "impact": "PPI Final Demand Services tracks upstream cost pressure specific to service industries — more relevant for restaurants, salons, and spas than the broad all-commodities index.",
            "source": "FRED",
        },
        {
            "series": "ENERGY_FUEL",
            "name": "Energy / Fuel Pressure",
            "current": round_or_none(fuel_current, 2),
            "change": round_or_none(pct_change(fuel_current, fuel_prev12), 1),
            "unit": "% YoY",
            "cadence": "year-over-year",
            "impact": "Oil and fuel prices affect delivery, freight, commuting, field service, and supplier costs over time.",
            "source": "FRED",
        },
        {
            "series": "FEDFUNDS",
            "name": "Interest Rate Pressure",
            "current": round_or_none(rates_current, 2),
            "change": round_or_none(point_change(rates_current, rates_prev12), 2),
            "unit": "%",
            "cadence": "12-month change",
            "impact": "Rates affect credit lines, equipment financing, inventory financing, and expansion decisions.",
            "source": "FRED",
        },
        {
            "series": "LABOR_COST",
            "name": "Labor Cost Pressure",
            "current": round_or_none(labor_current, 2),
            "change": round_or_none(pct_change(labor_current, labor_prev12), 1),
            "unit": "% YoY",
            "cadence": "year-over-year",
            "impact": "Labor is one of the biggest recurring expenses for many small and medium-sized businesses, so wage pressure deserves its own card.",
            "source": "BLS",
        },
        {
            "series": "M2SL",
            "name": "Monetary Backdrop (M2)",
            "current": round_or_none(m2_current, 1),
            "change": round_or_none(pct_change(m2_current, m2_prev12), 1),
            "unit": "Billions of Dollars",
            "cadence": "year-over-year",
            "impact": "M2 stays on the page as a separate macro backdrop for longer-range purchasing-power pressure.",
            "source": "FRED",
        },
        {
            "series": "UMCSENT",
            "name": "Consumer Sentiment",
            "current": round_or_none(sentiment_current, 1),
            "change": round_or_none(point_change(sentiment_current, sentiment_prev12), 1),
            "unit": "Index",
            "cadence": "12-month change",
            "impact": "Consumer sentiment measures how confident your customers feel about spending. When sentiment drops, discretionary service spending — dining out, salon visits, spa treatments — weakens first.",
            "source": "FRED",
        },
    ]

    return {
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "indicators": indicators,
    }

def main():
    snapshot = build_snapshot()
    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")

if __name__ == "__main__":
    main()
