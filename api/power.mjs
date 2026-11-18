// Server-side relay to NASA POWER's daily point service: the site's servers cache each answer for a day, and the
// browser never needs to reach nasa.gov itself. Only the daily point query is allowed, with fixed community and format.
const UPSTREAM = "https://power.larc.nasa.gov/api/temporal/daily/point";
const snap = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1);
const VARS_OK = /^[A-Z0-9_,]+$/;
const DATE_OK = /^\d{8}$/;

export default async function handler(req, res) {
  const q = req.query ?? {};
  const lat = Number(q.latitude);
  const lon = Number(q.longitude);
  if (!(lat >= -60 && lat <= 75 && lon >= -180 && lon <= 180)) return res.status(400).json({ error: "bad coordinates" });
  if (!DATE_OK.test(String(q.start ?? "")) || !DATE_OK.test(String(q.end ?? ""))) return res.status(400).json({ error: "bad dates" });
  if (!VARS_OK.test(String(q.parameters ?? ""))) return res.status(400).json({ error: "bad variables" });
  const out = new URLSearchParams({
    parameters: String(q.parameters),
    community: "AG",
    longitude: snap(lon),
    latitude: snap(lat),
    start: String(q.start),
    end: String(q.end),
    format: "JSON",
  });
  try {
    const r = await fetch(`${UPSTREAM}?${out.toString()}`);
    const body = await r.text();
    res.status(r.status);
    res.setHeader("content-type", r.headers.get("content-type") ?? "application/json");
    if (r.ok) res.setHeader("cache-control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ error: "upstream unreachable" });
  }
}
