import fs from "node:fs/promises";
import path from "node:path";

const apiKey = process.env.FRED_API_KEY;

if (!apiKey) {
  throw new Error("Missing FRED_API_KEY");
}

const seriesMeta = {
  CPIAUCSL: {
    name: "Inflation (CPI)",
    unit: "% YoY",
    cadence: "year-over-year",
    impact: "Ingredients, rent, and wages usually feel CPI pressure over time.",
    comparisonPeriods: 12
  },
  PPIACO: {
    name: "Producer Price Index (PPI)",
    unit: "% YoY",
    cadence: "year-over-year",
    impact: "Wholesale and supplier costs often show up in PPI before they hit menu prices.",
    comparisonPeriods: 12
  },
  DCOILWTICO: {
    name: "Oil / Gas Prices",
    unit: "$/barrel",
    cadence: "90-day change",
    impact: "Fuel moves transport, delivery, and some supplier operating costs.",
    comparisonPeriods: 90,
    isDaily: true
  },
  FEDFUNDS: {
    name: "Fed Funds Rate",
    unit: "%",
    cadence: "12-month change",
    impact: "Borrowing, credit card balances, and expansion decisions all become more sensitive as rates rise.",
    comparisonPeriods: 12
  },
  M2SL: {
    name: "Money Supply (M2)",
    unit: "% YoY",
    cadence: "year-over-year",
    impact: "M2 helps frame long-term monetary inflation pressure even when CPI looks slower in the short run.",
    comparisonPeriods: 12
  }
};

function getValidObservations(observations) {
  return observations.filter(
    (obs) =>
      obs.value !== "." &&
      obs.value !== null &&
      obs.value !== undefined &&
      !Number.isNaN(parseFloat(obs.value))
  );
}

async function getFREDSeries(seriesId) {
  const meta = seriesMeta[seriesId];
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${encodeURIComponent(seriesId)}` +
    `&api_key=${encodeURIComponent(apiKey)}` +
    `&file_type=json&sort_order=asc`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FRED request failed for ${seriesId}: ${response.status}`);
  }

  const data = await response.json();
  const valid = getValidObservations(data.observations || []);
  if (!valid.length) {
    throw new Error(`No valid observations for ${seriesId}`);
  }

  const latest = parseFloat(valid[valid.length - 1].value);

  let compareIndex;
  if (meta.isDaily) {
    compareIndex = Math.max(0, valid.length - 91);
  } else {
    compareIndex = Math.max(0, valid.length - (meta.comparisonPeriods + 1));
  }

  const previous = parseFloat(valid[compareIndex].value);
  const change = previous === 0 ? 0 : ((latest - previous) / previous) * 100;

  return {
    name: meta.name,
    series: seriesId,
    current: latest,
    change,
    unit: meta.unit,
    cadence: meta.cadence,
    impact: meta.impact,
    updatedAt: new Date().toISOString()
  };
}

const seriesIds = ["CPIAUCSL", "PPIACO", "DCOILWTICO", "FEDFUNDS", "M2SL"];
const indicators = [];

for (const seriesId of seriesIds) {
  const indicator = await getFREDSeries(seriesId);
  indicators.push(indicator);
}

const output = {
  generatedAt: new Date().toISOString(),
  indicators
};

await fs.mkdir(path.join(process.cwd(), "data", "fred"), { recursive: true });
await fs.writeFile(
  path.join(process.cwd(), "data", "fred", "latest.json"),
  JSON.stringify(output, null, 2),
  "utf8"
);

console.log("Wrote data/fred/latest.json");
