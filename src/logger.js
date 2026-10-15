const pino = require('pino');
const config = require('./config');

// Structured JSON logs. Personal data (phone, email, names, tokens) must never be logged:
// request bodies are not logged, and these headers/fields are redacted if they ever appear.
module.exports = pino({
  level: config.logLevel,
  base: { app: config.appName },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.phone', '*.email', '*.first_name', '*.last_name'], censor: '[redacted]' }
});
