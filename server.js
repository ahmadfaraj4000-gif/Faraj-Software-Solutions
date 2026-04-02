const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const FRED_API_KEY = process.env.FRED_API_KEY;

// Serve your static files from this folder
app.use(express.static(__dirname));

// Proxy route for FRED
app.get("/api/fred", async (req, res) => {
  try {
    const { series_id } = req.query;

    if (!series_id) {
      return res.status(400).json({ error: "Missing series_id query parameter" });
    }

    if (!FRED_API_KEY) {
      return res.status(500).json({ error: "Missing FRED_API_KEY environment variable" });
    }

    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(
      series_id
    )}&api_key=${encodeURIComponent(FRED_API_KEY)}&file_type=json&sort_order=asc`;

    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "FRED request failed",
        details: text,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ error: "Server error while fetching FRED data" });
  }
});

// Optional: default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});