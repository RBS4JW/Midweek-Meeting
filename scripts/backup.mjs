// Backs up every midweek table to backups/*.json and keeps the project awake.
// Reads url + anon key straight from public/config.js (no secrets to manage).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const cfg = readFileSync('public/config.js', 'utf8');
const URL = (cfg.match(/url:\s*'([^']+)'/) || [])[1];
const KEY = (cfg.match(/key:\s*'([^']+)'/) || [])[1];
const SCHEMA = (cfg.match(/schema:\s*'([^']+)'/) || [])[1] || 'midweek';
if (!URL || !KEY) { console.error('No url/key in public/config.js'); process.exit(1); }
const TABLES = ['part_codes','members','member_pools','assignments','meetings','meeting_parts'];
async function fetchAll(t){
  const out=[]; const step=1000; let from=0;
  for(;;){
    const r=await fetch(`${URL}/rest/v1/${t}?select=*`,{headers:{
      apikey:KEY, Authorization:`Bearer ${KEY}`, 'Accept-Profile':SCHEMA,
      'Range-Unit':'items', Range:`${from}-${from+step-1}`}});
    if(!r.ok) throw new Error(`${t}: HTTP ${r.status} ${await r.text()}`);
    const rows=await r.json(); out.push(...rows);
    if(rows.length<step) break; from+=step;
  }
  return out;
}
mkdirSync('backups',{recursive:true});
const manifest={generated_at:new Date().toISOString(),source:URL,schema:SCHEMA,tables:{}};
for(const t of TABLES){ const rows=await fetchAll(t); writeFileSync(`backups/${t}.json`,JSON.stringify(rows,null,1)); manifest.tables[t]=rows.length; }
writeFileSync('backups/_manifest.json',JSON.stringify(manifest,null,2));
console.log('backup ok', manifest.tables);
