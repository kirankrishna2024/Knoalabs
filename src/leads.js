const express = require('express');
const config = require('./config');
const Lead = require('./models/Lead');
const rateLimit = require('./rateLimit');
const { validateLead } = require('./validate');

const router = express.Router();

/* ---------- POST /api/leads : public, called by the registration form ---------- */
router.post('/leads', rateLimit({ max: config.rateLimitMax }), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true });          // honeypot: pretend success to bots

    const { errors, lead } = validateLead(body);
    if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors });

    lead.ip = req.ip || null;
    lead.user_agent = String(req.headers['user-agent'] || '').slice(0, 300) || null;

    const { lead: saved, duplicate } = await Lead.createOnce(lead);
    if (!duplicate) req.log.info({ leadId: saved.id, course: saved.course_slug }, 'lead saved');
    res.status(duplicate ? 200 : 201).json({ ok: true, id: saved.id, duplicate });
  } catch (e) {
    req.log.error({ err: e.message }, 'lead submit failed');
    if (!res.headersSent) res.status(500).json({ ok: false, error: 'We could not save your details. Please try again.' });
    else next(e);
  }
});

module.exports = router;
