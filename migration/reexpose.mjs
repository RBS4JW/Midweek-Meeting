// Surgical fix: re-append `midweek` to the authenticator role's pgrst.db_schemas
// (PostgREST dropped it back to public, graphql_public — breaking all data loads).
// Does NOT touch any schema or data; only the exposed-schemas setting + reload.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '..');
for (const line of (fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('✗ DATABASE_URL not set'); process.exit(1); }

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query(`
    select s.setconfig, s.setdatabase
    from pg_db_role_setting s
    join pg_roles r on r.oid = s.setrole
    where r.rolname = 'authenticator'`);
  const dbOid = (await client.query('select oid from pg_database where datname = current_database()')).rows[0].oid;
  const pick = rows.find(r => String(r.setdatabase) === String(dbOid)) || rows.find(r => String(r.setdatabase) === '0');
  let current = 'public, graphql_public';
  if (pick) {
    const hit = (pick.setconfig || []).find(x => x.startsWith('pgrst.db_schemas='));
    if (hit) current = hit.slice('pgrst.db_schemas='.length);
  }
  const list = current.split(',').map(s => s.trim()).filter(Boolean);
  if (list.includes('midweek')) {
    console.log('• midweek already exposed (' + current + ') — reloading anyway');
  } else {
    list.push('midweek');
    const next = list.join(', ');
    await client.query(`alter role authenticator set pgrst.db_schemas = '${next}'`);
    console.log('• exposed schemas ' + JSON.stringify(current) + ' → ' + JSON.stringify(next));
  }
  await client.query(`notify pgrst, 'reload config'`);
  await client.query(`notify pgrst, 'reload schema'`);
  console.log('• NOTIFY pgrst reload config + schema sent');
} finally {
  await client.end();
}
