// Real visitor IP behind a platform that puts it in a dedicated header.
//
// DigitalOcean App Platform: X-Forwarded-For carries the address of DigitalOcean's own ingress server, NOT the visitor,
// so with TRUST_PROXY alone every visitor shares one IP and therefore one rate-limit bucket (after RATE_LIMIT_MAX
// registrations, or ADMIN_LOGIN_MAX login attempts, in 10 minutes the whole site would answer 429). The visitor's address
// is in the `do-connecting-ip` header, which the ingress sets itself.
//
// Opt-in on purpose (CLIENT_IP_HEADER=do-connecting-ip): a client can send any header it likes, so this must only be
// switched on when the platform in front of the app overwrites that header.
const net = require('net');

const HEADER_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** Express middleware: when `header` is set and carries a valid IP, req.ip becomes that address. */
function clientIp(header) {
  const name = String(header || '').trim().toLowerCase();
  if (!name) return (_req, _res, next) => next();
  return (req, _res, next) => {
    const raw = req.headers[name];
    const value = String(Array.isArray(raw) ? raw[0] : raw || '').split(',')[0].trim();
    if (value && net.isIP(value)) Object.defineProperty(req, 'ip', { value, configurable: true, enumerable: true, writable: true });
    next();
  };
}

module.exports = { clientIp, HEADER_RE };
