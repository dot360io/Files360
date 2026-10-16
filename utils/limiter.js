const { HttpError } = require('./errors');

// Small promise queue so image processing never takes over the CPU.
function createLimiter(maxActive, maxQueued) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= maxActive || queue.length === 0) return;
    active += 1;
    const job = queue.shift();
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  const run = (fn) =>
    new Promise((resolve, reject) => {
      if (queue.length >= maxQueued) {
        reject(new HttpError(503, 'busy', 'The service is busy processing other images, retry in a few seconds'));
        return;
      }
      queue.push({ fn, resolve, reject });
      next();
    });

  run.stats = () => ({ active, queued: queue.length });
  return run;
}

module.exports = createLimiter;
