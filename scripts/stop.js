// npm run stop : free the app's port by killing whatever is listening on it (works on Windows, macOS and Linux).
require('dotenv').config();
const { execSync } = require('child_process');
const port = Number(process.env.PORT) || 8080;
const win = process.platform === 'win32';
let pids = new Set();
try {
  if (win) {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    for (const l of out.split(/\r?\n/)) { const c = l.trim().split(/\s+/); if (c[3] === 'LISTENING' && c[1].endsWith(':' + port)) pids.add(c[4]); }
  } else {
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || true`, { encoding: 'utf8', shell: '/bin/sh' });
    out.split(/\s+/).filter(Boolean).forEach((p) => pids.add(p));
    if (!pids.size) {   // no lsof on this machine: fall back to ss
      const ss = execSync(`ss -ltnpH 2>/dev/null || true`, { encoding: 'utf8', shell: '/bin/sh' });
      for (const l of ss.split('\n')) { if (new RegExp(`:${port}\\s`).test(l)) { const m = /pid=(\d+)/.exec(l); if (m) pids.add(m[1]); } }
    }
  }
} catch (e) { console.error('Could not look up the port:', e.message); process.exit(1); }
pids.delete(String(process.pid));
if (!pids.size) { console.log(`Nothing is listening on port ${port}.`); process.exit(0); }
for (const pid of pids) {
  try { execSync(win ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`, { stdio: 'ignore' }); console.log(`Stopped process ${pid} (port ${port}).`); }
  catch { console.error(`Could not stop process ${pid}.`); }
}
