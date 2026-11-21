// Cloudflare D1 arayüzünü node:sqlite ile taklit eder; testler gerçek şemayı (migrations/*.sql) ve gerçek SQL'i çalıştırır.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(join(root, 'migrations')).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));

  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p.map((v) => (v === undefined ? null : v))); }
    _all() { return db.prepare(this.sql).all(...this.params); }
    async first(col) { const r = db.prepare(this.sql).get(...this.params); if (!r) return null; return col ? r[col] : { ...r }; }
    async all() { return { results: this._all().map((r) => ({ ...r })), success: true }; }
    async run() { const r = db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes) } }; }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    // D1 batch() gibi tek işlemdir; hata olursa hepsi geri alınır.
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => ({ results: s._all().map((r) => ({ ...r })), success: true }));
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
