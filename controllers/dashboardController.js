const config = require('../config/env');
const App = require('../models/App');
const Image = require('../models/Image');

const DAYS = 30;

exports.index = async (req, res) => {
  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const [apps, recent, daily] = await Promise.all([
    App.find().sort({ 'stats.bytesOut': -1 }).lean(),
    Image.find().sort({ createdAt: -1 }).limit(10).populate('app', 'name slug').lean(),
    Image.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: config.timezone } },
          count: { $sum: 1 },
          bytes: { $sum: '$bytesOut' },
        },
      },
    ]),
  ]);

  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, day: 'numeric', month: 'short' });
  const byDay = new Map(daily.map((d) => [d._id, d]));
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
