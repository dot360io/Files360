const config = require('../config/env');
const db = require('../db');

const DAYS = 30;

exports.index = async (req, res) => {
  // A day of margin either side of UTC midnight covers every time zone
  const since = new Date(Date.now() - DAYS * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const [apps, recent, slots] = await Promise.all([
    db.apps.list({ sort: 'bytesOut' }),
    db.assets.recent({ limit: 10 }),
    db.assets.uploadSlots(since.getTime()),
  ]);

  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, day: 'numeric', month: 'short' });
  // The database buckets by UTC quarter hour; the local day is worked out here,
  // because no time zone function means the same thing on all three engines
  const byDay = new Map();
  for (const s of slots) {
    const key = dayKey.format(new Date(s.at));
    const day = byDay.get(key) || { count: 0, bytes: 0 };
    day.count += s.count;
    day.bytes += s.bytes;
    byDay.set(key, day);
  }
  const chart = [];
  for (let i = DAYS - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    const entry = byDay.get(dayKey.format(d));
    chart.push({ label: dayLabel.format(d), count: entry ? entry.count : 0, bytes: entry ? entry.bytes : 0 });
  }

  const totals = apps.reduce(
    (t, a) => ({
      images: t.images + (a.stats.images || 0),
      bytesIn: t.bytesIn + (a.stats.bytesIn || 0),
      bytesOut: t.bytesOut + (a.stats.bytesOut || 0),
    }),
    { images: 0, bytesIn: 0, bytesOut: 0 }
  );

  res.render('dashboard/index', {
    title: 'Dashboard',
    section: 'dashboard',
    apps,
    recent,
    chart,
    chartMax: Math.max(1, ...chart.map((c) => c.count)),
    last30: chart.reduce((s, c) => s + c.count, 0),
    totals,
  });
};
