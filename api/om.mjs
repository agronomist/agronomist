// Server-side relay to the Open-Meteo archive with the paid key, so the key never reaches the browser.
// Only the archive's daily weather query is allowed, with the page's own parameters.
const PAID = "https://customer-archive-api.open-meteo.com/v1/archive";
const FREE = "https://archive-api.open-meteo.com/v1/archive";
// once the paid endpoint has refused this key (plan without the archive), stop asking until the function restarts
let paidRefused = false;
// the weather source is a grid about 10 to 25 km wide, so places within 0.1 degree get the same answer: snap to it so
// nearby visitors share one cached answer
const snap = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1);
const ALLOWED = new Set(["latitude", "longitude", "start_date", "end_date", "daily", "timezone"]);
const DAILY_OK = /^[a-z0-9_,]+$/;
const DATE_OK = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  const key = process.env.OPEN_METEO_KEY;
  const q = req.query ?? {};
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    // anything not on the list is dropped, so nothing else can be sent upstream with the key
    if (ALLOWED.has(k) && typeof v === "string") out.set(k, v);
  }
  const lat = Number(out.get("latitude"));
  const lon = Number(out.get("longitude"));
  if (!(lat >= -60 && lat <= 75 && lon >= -180 && lon <= 180)) return res.status(400).json({ error: "bad coordinates" });
  if (!DATE_OK.test(out.get("start_date") ?? "") || !DATE_OK.test(out.get("end_date") ?? "")) return res.status(400).json({ error: "bad dates" });
  if (!DAILY_OK.test(out.get("daily") ?? "")) return res.status(400).json({ error: "bad variables" });
  out.set("latitude", snap(lat));
  out.set("longitude", snap(lon));
  try {
    let r;
    if (key && !paidRefused) {
      const paid = new URLSearchParams(out);
      paid.set("apikey", key);
      r = await fetch(`${PAID}?${paid.toString()}`);
      if (r.status === 401 || r.status === 403) {
        paidRefused = true;
        r = undefined;
      }
    }
    // the free archive, called from the site's servers: answers are cached below, so few calls are made
    r = r ?? (await fetch(`${FREE}?${out.toString()}`));
    const body = await r.text();
    res.status(r.status);
    res.setHeader("content-type", r.headers.get("content-type") ?? "application/json");
    // past weather does not change: let the CDN keep each answer for a day
    if (r.ok) res.setHeader("cache-control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.send(body);
  } catch (e) {
    return res.status(502).json({ error: "upstream unreachable" });
  }
}
