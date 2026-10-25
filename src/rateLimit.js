// Small in-memory limiter (per IP). Fine for one instance; with several instances each keeps its own
// counters, so put a shared limit at the edge (Cloudflare / load balancer) or move this to Redis.
module.exports = function rateLimit({ windowMs = 10 * 60 * 1000, max = 10, maxKeys = 50000 } = {}) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset <= now) hits.delete(k); }, Math.min(windowMs, 60000)).unref();
  return (req, res, next) => {
    const now = Date.now();
    let h = hits.get(req.ip);
    if (!h || h.reset <= now) {
      if (!h && hits.size >= maxKeys) hits.delete(hits.keys().next().value);   // bounded memory under a flood
      h = { n: 0, reset: now + windowMs }; hits.set(req.ip, h);
    }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ ok: false, error: 'Too many attempts. Please try again in a few minutes.' });
    }
    next();
  };
};
