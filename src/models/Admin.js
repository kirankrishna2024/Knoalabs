const db = require('../db');

/** Admin panel logins. Usernames are stored lower-case; passwords only as scrypt hashes (see auth.js). */
class Admin {
  static async findByUsername(username) {
    const { rows } = await db.query(
      'SELECT id, username, password_hash, created_at, last_login_at FROM admin_users WHERE username=$1',
      [String(username || '').trim().toLowerCase()]);
    return rows[0] || null;
  }

  static async count() {
    return (await db.query('SELECT COUNT(*)::int AS n FROM admin_users')).rows[0].n;
  }

  /** Create the user, or change the password when it already exists. Returns 'created' | 'updated'. */
  static async upsert(username, passwordHash) {
    const u = String(username).trim().toLowerCase();
    const existing = await Admin.findByUsername(u);
    if (existing) {
      await db.query('UPDATE admin_users SET password_hash=$1, updated_at=now() WHERE id=$2', [passwordHash, existing.id]);
      return 'updated';
    }
    await db.query('INSERT INTO admin_users (username, password_hash) VALUES ($1,$2)', [u, passwordHash]);
    return 'created';
  }

  static async touchLogin(id) {
    await db.query('UPDATE admin_users SET last_login_at=now() WHERE id=$1', [id]);
  }
}

module.exports = Admin;
