export default async function handler(req, res) {
  const lat = Number(req.query.lat), lon = Number(req.query.lon), y0 = Number(req.query.y0), y1 = Number(req.query.y1);
  if (!(lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66 && y0 >= 1995 && y1 <= 2024 && y1 - y0 <= 12)) return res.status(400).json({ error: "bad" });
  const om = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${y0}-01-01&end_date=${y1}-12-31&daily=precipitation_sum&timezone=auto`)).json();
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const pw = await Promise.all(years.map(async (y) => (await (await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR&community=AG&latitude=${lat}&longitude=${lon}&start=${y}0101&end=${y}1231&format=JSON`)).json()).properties?.parameter?.PRECTOTCORR ?? {}));
  const omMap = {}; om.daily.time.forEach((t, i) => (omMap[t.replaceAll("-", "")] = om.daily.precipitation_sum[i] ?? 0));
  const out = { lat, lon, years: {}, daily: {} };
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, heavyA = 0, heavyB = 0, wetA = 0, wetB = 0;
  years.forEach((y, k) => {
    let a = 0, b = 0;
    for (const [d, v] of Object.entries(pw[k])) {
      if (v < 0 || !(d.slice(4, 6) >= "05" && d.slice(4, 6) <= "09")) continue;
      const o = omMap[d]; if (o === undefined) continue;
      a += v; b += o; n++; sa += v; sb += o; saa += v * v; sbb += o * o; sab += v * o;
      if (v >= 10) heavyA++; if (o >= 10) heavyB++; if (v >= 1) wetA++; if (o >= 1) wetB++;
    }
    out.years[y] = [Math.round(a), Math.round(b)];
  });
  const cov = sab / n - (sa / n) * (sb / n);
  out.daily = { n, corr: +(cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2))).toFixed(2), wetDaysPower: wetA, wetDaysOM: wetB, heavyDaysPower: heavyA, heavyDaysOM: heavyB };
  res.status(200).json(out);
}
