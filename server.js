const express = require("express");
const fs = require("fs");
const path = require("path");

loadLocalEnv([".env.local", ".env"]);

const app = express();
const PORT = process.env.PORT || 3000;
const FRED_API_KEY = process.env.FRED_API_KEY;

function loadLocalEnv(files) {
  for (const file of files) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;

    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key] !== undefined) continue;

      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
}

function setApiCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function numericObservations(observations) {
  return (observations || [])
    .map((row) => ({ date: row.date, value: Number.parseFloat(row.value) }))
    .filter((row) => Number.isFinite(row.value));
}

function calculateYearOverYear(observations) {
  const rows = numericObservations(observations);
  if (rows.length < 13) return null;
  const latest = rows[rows.length - 1];
  const yearAgo = rows[Math.max(0, rows.length - 13)];
  if (!yearAgo?.value) return null;
  return {
    latest,
    yearAgo,
    change: ((latest.value - yearAgo.value) / yearAgo.value) * 100,
  };
}

async function fetchFredObservations(seriesId) {
  if (!FRED_API_KEY) {
    const error = new Error("Missing FRED_API_KEY environment variable");
    error.status = 500;
    throw error;
  }

  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
    seriesId
  )}&api_key=${encodeURIComponent(FRED_API_KEY)}&file_type=json&sort_order=asc`;

  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    const error = new Error("FRED request failed");
    error.status = response.status;
    error.details = text;
    throw error;
  }

  return response.json();
}

// Serve your static files from this folder
app.use(express.static(__dirname));

app.options("/api/*", (req, res) => {
  setApiCors(res);
  res.sendStatus(204);
});

// Proxy route for FRED
app.get("/api/fred", async (req, res) => {
  setApiCors(res);
  try {
    const { series_id } = req.query;

    if (!series_id) {
      return res.status(400).json({ error: "Missing series_id query parameter" });
    }

    const data = await fetchFredObservations(series_id);
    res.json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(error.status || 500).json({
      error: error.message || "Server error while fetching FRED data",
      details: error.details,
    });
  }
});

app.get(["/api/market/latest", "/api/pricing-assistant/market/latest"], async (req, res) => {
  setApiCors(res);
  try {
    const m2Data = await fetchFredObservations("M2SL");
    const yoy = calculateYearOverYear(m2Data.observations);
    if (!yoy) {
      return res.status(502).json({ error: "Not enough M2 observations returned from FRED" });
    }

    res.json({
      updated_at: new Date().toISOString(),
      indicators: [
        {
          series: "M2SL",
          name: "Monetary Backdrop (M2)",
          current: yoy.latest.value,
          previous: yoy.yearAgo.value,
          change: yoy.change,
          date: yoy.latest.date,
          source: "FRED",
        },
      ],
    });
  } catch (error) {
    console.error("Market snapshot error:", error);
    res.status(error.status || 500).json({
      error: error.message || "Server error while fetching market data",
      details: error.details,
    });
  }
});

app.get("/api/pricing-assistant/fred-m2", async (req, res) => {
  setApiCors(res);
  try {
    const data = await fetchFredObservations("M2SL");
    res.json(data);
  } catch (error) {
    console.error("Pricing Assistant M2 proxy error:", error);
    res.status(error.status || 500).json({
      error: error.message || "Server error while fetching M2 data",
      details: error.details,
    });
  }
});

// Optional: default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
