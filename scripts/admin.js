// Create an admin login, or change its password:
//   npm run admin:set -- <id> [password]       (password is asked for, hidden, when you leave it out)
// Changing a password signs that admin out everywhere.
const readline = require('readline');
const db = require('../src/db');
const auth = require('../src/auth');
const Admin = require('../src/models/Admin');
const migrate = require('../src/migrate');

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };   // hide what is typed
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  try {
    const username = String(process.argv[2] || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Usage: npm run admin:set -- <id> [password]   (id: 3-40 letters/digits/._-)');
    const password = process.argv[3] || await askHidden('New password (min 10 characters): ');
    if (password.length < 10) throw new Error('Password must be at least 10 characters.');

    const pool = db.init();
    await migrate.run(pool);                                  // makes sure admin_users exists
    const result = await Admin.upsert(username, await auth.hashPassword(password));
    console.log(`Admin "${username}" ${result}.`);
    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
