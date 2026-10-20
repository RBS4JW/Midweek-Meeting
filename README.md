# JW · PROPER STA. FE — Eskedyul sa Midweek nga Tigom

A web app for the Sta. Fe congregation scheduler to **assign bahin** and **prepare
the Midweek Meeting schedule**. Rebuilt from *"JW Docs.xlsx"* (the `Scheduler 1/2`
grids and the `Bahin 1–8` printable programs) — every member, the full 2026
assignment history, and the sample weekly programs are carried over.

- **Database:** Supabase (PostgreSQL) — the *same dedicated Sta. Fe project* as the
  Field Service app, but **everything lives in an isolated `midweek` schema**.
  The existing Field Service tables in `public` are never touched.
- **Hosting:** Cloudflare Pages. No build step — a plain static site in `/public`
  that talks straight to Supabase (anon key + Row Level Security).

---

## What it does

| Feature | Where | Notes |
|---|---|---|
| **Assign Bahin** | *Assign Bahin* tab | The scheduler grid (members × weeks). Pick a part code per cell; a `Σ` column and the per-code counts in the picker help you rotate fairly. One tab per pool: Elders, Ministerial Servants, Bible Reading, Publishers. |
| **Prepare Eskedyul** | *Eskedyul* tab | One editable program per week. “New week” drops in a standard skeleton; fill the titles and pick names (member suggestions + a “how many parts so far” hint). **🖨 Print** produces the posted sheet, matching the original layout. Handles special weeks (assembly / no meeting). |
| **Members** | *Members* tab | Add/edit people and which pools they belong to, with eligibility notes (e.g. *ENB only*, *CLP only*). |
| **Legend** | *Legend* tab | Edit the part-code labels per pool. |

Data model (all in `midweek`): `members`, `member_pools`, `part_codes`,
`assignments` (the grid), `meetings` + `meeting_parts` (the weekly programs).

---

## Deploy

### 1. Database (one command)
```bash
cd migration && npm install && cd ..
cp .env.example .env        # paste the Sta. Fe Session-pooler DATABASE_URL (role postgres)
node migration/deploy.mjs --dry-run   # installs, verifies, proves isolation, rolls back
node migration/deploy.mjs             # commit for real
```
The deploy script creates the `midweek` schema, loads the data, **exposes the
schema to the API** (appends `midweek` to the authenticator's `pgrst.db_schemas`
without dropping `public`/`graphql_public`), and **aborts if any table outside
`midweek` changed**.

> Prefer the dashboard? Run `sql/01_schema.sql` then `sql/02_seed.sql` in the
> Supabase SQL Editor, then add **midweek** under *Settings → API → Exposed schemas*.

### 2. Frontend
`public/config.js` is already pointed at the Sta. Fe project with its anon key.
```bash
wrangler pages deploy public --project-name sta-fe-midweek-meeting
```
or upload the contents of `public/` via the Cloudflare dashboard.

### Local preview
```bash
node server.js     # http://localhost:8788
```

## Backups
`scripts/backup.mjs` snapshots every `midweek` table to `backups/*.json` and keeps
the project awake; `.github/workflows/backup.yml` runs it every 4 days.
