/**
 * Installs the Eskedyul sa Midweek nga Tigom schema on the dedicated Sta. Fe
 * Supabase project — and proves, before committing, that it changed nothing
 * that belongs to the existing Field Service app (everything in `public`).
 *
 *   node migration/deploy.mjs --dry-run     install, verify, then ROLL BACK (no effect)
 *   node migration/deploy.mjs               install, commit only if isolation holds
 *
 * Reads DATABASE_URL from ../.env (gitignored). Supabase → Connect → Session
 * pooler (port 5432), role `postgres` (it must create the schema and expose it
 * to the API).
 *
 * Isolation proof
 *   1. One transaction. Fingerprint every table OUTSIDE `midweek` with its exact
 *      row count (public + anything else the project has).
 *   2. Run sql/01_schema.sql then sql/02_seed.sql (all inside `midweek`).
 *   3. Expose the `midweek` schema to PostgREST by APPENDING it to the
 *      authenticator role's pgrst.db_schemas (never dropping public /
 *      graphql_public), then NOTIFY pgrst to reload.
 *   4. Fingerprint again and diff: any non-midweek table whose row count moved
 *      → ROLLBACK and abort. The only intended change outside `midweek` is the
 *      one API setting above.
 *   5. Verify the midweek row counts match the Excel, then COMMIT
 *      (or ROLLBACK anyway when --dry-run).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');

// ── .env ──
for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('✗ DATABASE_URL not set (create migration/../.env). See .env.example'); process.exit(1); }

const read = f => fs.readFileSync(path.join(ROOT, 'sql', f), 'utf8');
const log = (...a) => console.log(...a);

async function fingerprint(client) {
  const { rows } = await client.query(`
    select n.nspname as schema, c.relname as table,
           coalesce((select reltuples::bigint from pg_class x where x.oid=c.oid),0) as est
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname not in ('pg_catalog','information_schema','midweek')
      and n.nspname not like 'pg_%'`);
  // exact counts (dataset is small)
  const out = {};
  for (const r of rows) {
    const { rows: [{ n }] } = await client.query(`select count(*)::bigint n from "${r.schema}"."${r.table}"`);
    out[`${r.schema}.${r.table}`] = Number(n);
  }
  return out;
}

async function exposeSchema(client) {
  // pgrst.db_schemas is stored in pg_db_role_setting.setconfig for the
  // `authenticator` role — either per-database or role-wide (setdatabase = 0).
  const { rows } = await client.query(`
    select s.setconfig, s.setdatabase
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator'`);
  const dbOid = (await client.query('select oid from pg_database where datname = current_database()')).rows[0].oid;
  // prefer a per-database setting, else the role-wide (setdatabase = 0) one
  const pick = rows.find(r => String(r.setdatabase) === String(dbOid)) || rows.find(r => String(r.setdatabase) === '0');
  let current = 'public, graphql_public';
  if (pick) {
    const hit = (pick.setconfig || []).find(x => x.startsWith('pgrst.db_schemas='));
    if (hit) current = hit.slice('pgrst.db_schemas='.length);
  }
  const list = current.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('midweek')) { log('• API: midweek already exposed ('+current+')'); return false; }
  list.push('midweek');
  const next = list.join(', ');
  await client.query(`alter role authenticator set pgrst.db_schemas = '${next}'`);
  await client.query(`notify pgrst, 'reload config'`);
  await client.query(`notify pgrst, 'reload schema'`);
  log(`• API: exposed schemas ${JSON.stringify(current)} → ${JSON.stringify(next)}`);
  return true;
}

(async () => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  log(`\n=== Sta. Fe · Midweek deploy ${DRY ? '(DRY RUN)' : ''} ===`);
  try {
    await client.query('begin');

    log('• snapshot (non-midweek tables)…');
    const before = await fingerprint(client);
    log(`  ${Object.keys(before).length} existing tables fingerprinted`);

    log('• apply sql/01_schema.sql');
    await client.query(read('01_schema.sql'));
    log('• apply sql/02_seed.sql');
    await client.query(read('02_seed.sql'));

    await exposeSchema(client);

    log('• snapshot again & diff…');
    const after = await fingerprint(client);
    const changed = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)]))
      if (before[k] !== after[k]) changed.push(`${k}: ${before[k]} → ${after[k]}`);
    if (changed.length) {
      await client.query('rollback');
      console.error('✗ ISOLATION VIOLATION — a non-midweek table changed:\n  ' + changed.join('\n  '));
      process.exit(2);
    }
    log('  ✓ nothing outside `midweek` changed');

    // verify midweek counts
    const counts = {};
    for (const t of ['part_codes', 'members', 'member_pools', 'assignments', 'meetings', 'meeting_parts']) {
      const { rows: [{ n }] } = await client.query(`select count(*)::int n from midweek.${t}`);
      counts[t] = n;
    }
    log('• midweek row counts: ' + JSON.stringify(counts));

    if (DRY) { await client.query('rollback'); log('• DRY RUN → rolled back. No changes committed.\n'); }
    else { await client.query('commit'); log('• COMMITTED ✓\n'); }
  } catch (e) {
    try { await client.query('rollback'); } catch {}
    console.error('✗ deploy failed:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
