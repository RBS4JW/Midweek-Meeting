/* =========================================================================
   Eskedyul sa Midweek nga Tigom — Sta. Fe Congregation
   Vanilla JS SPA. Talks to the isolated `midweek` schema in Supabase.
   ========================================================================= */
'use strict';

const POOLS = [
  { key: 'elder',         label: 'Elders' },
  { key: 'ms',            label: 'Ministerial Servants' },
  { key: 'bible_reading', label: 'Bible Reading' },
  { key: 'female',        label: 'Publishers (Magmaepektibo)' },
];
const POOL_LABEL = Object.fromEntries(POOLS.map(p => [p.key, p.label]));

const SECTION_ORDER = ['INTRO', 'BAHANDI', 'MAGMAEPEKTIBO', 'KRISTOHANONG PAGKINABUHI', 'KONKLUSYON'];
const SECTION_TITLE = {
  INTRO: '', BAHANDI: 'BAHANDI GIKAN SA PULONG SA DIYOS',
  MAGMAEPEKTIBO: 'MAGMAEPEKTIBO SA MINISTERYO',
  'KRISTOHANONG PAGKINABUHI': 'KRISTOHANONG PAGKINABUHI', KONKLUSYON: '',
};

let sb = null;                                   // supabase client (schema: midweek)
const state = { members: [], pools: [], codes: [], assigns: [], meetings: [], parts: [] };
let currentView = 'eskedyul';

/* ----------------------------- helpers -------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach(c => c != null &&
    n.append(c.nodeType ? c : document.createTextNode(c)));
  return n;
};
const esc = s => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
const fmtShort = iso => { const d = new Date(iso + 'T00:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); };
const MONTHS = ['Ene','Peb','Mar','Abr','May','Hun','Hul','Ago','Sep','Okt','Nob','Dis'];
const fmtMonth = iso => MONTHS[new Date(iso + 'T00:00:00').getMonth()];

// ---- auto week-label (continues the sequence from existing weeks) ----
const CEBU_MONTHS = ['ENERO','PEBRERO','MARSO','ABRIL','MAYO','HUNYO','HULYO','AGOSTO','SEPTIYEMBRE','OKTUBRE','NOBYEMBRE','DISYEMBRE'];
function parseLabelEnd(label, year) {
  if (!label) return null;
  const s = label.trim().toUpperCase().replace(/[–—]/g, '-');
  let m = s.match(/^([A-ZÑ]+)\s+(\d+)\s*-\s*([A-ZÑ]+)\s+(\d+)$/);   // cross-month: "SEPTIYEMBRE 28 - OKTUBRE 4"
  if (m) { const sm = CEBU_MONTHS.indexOf(m[1]), em = CEBU_MONTHS.indexOf(m[3]); if (sm < 0 || em < 0) return null; return new Date(em < sm ? year + 1 : year, em, +m[4]); }
  m = s.match(/^([A-ZÑ]+)\s+(\d+)\s*-\s*(\d+)$/);                   // same-month: "OKTUBRE 5-11"
  if (m) { const mm = CEBU_MONTHS.indexOf(m[1]); if (mm < 0) return null; return new Date(year, mm, +m[3]); }
  return null;
}
function fmtWeekLabel(start, end) {
  const sM = CEBU_MONTHS[start.getMonth()], sD = start.getDate(), eM = CEBU_MONTHS[end.getMonth()], eD = end.getDate();
  return start.getMonth() === end.getMonth() ? `${sM} ${sD}-${eD}` : `${sM} ${sD} - ${eM} ${eD}`;
}
function baseYear() {
  const ys = state.assigns.map(a => +String(a.meeting_date).slice(0, 4)).filter(Boolean);
  return ys.length ? Math.max(...ys) : new Date().getFullYear();
}
// the next 7-day week after the latest existing week; falls back to the
// current week when nothing parseable exists yet.
function nextWeekLabel() {
  const yr = baseYear();
  let maxEnd = null;
  for (const mt of state.meetings) { const e = parseLabelEnd(mt.week_label, yr); if (e && (!maxEnd || e > maxEnd)) maxEnd = e; }
  let start;
  if (maxEnd) { start = new Date(maxEnd); start.setDate(start.getDate() + 1); }
  else { start = new Date(); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); } // this week's Monday
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return fmtWeekLabel(start, end);
}

// ---- per-code colour scheme (consistent everywhere a code is shown) ----
const CODE_COLORS = {
  CH: '#6e40c9', COP: '#8957e5', KP1: '#1f6feb', KP2: '#2f81f7', CBS: '#1a7f37', CLP: '#bf8700', OP: '#9a6700',
  PP1: '#0969da', ENB: '#cf222e', PP2: '#bc4c00', CBSR: '#117964', BR: '#8250df',
  '4E': '#1a7f37', '4A': '#2da44e', '5E': '#0969da', '5A': '#3a86e0',
  '6E': '#bc4c00', '6A': '#e16f24', '7E': '#8250df', '7A': '#8b63e0',
};
function codeColor(code) {
  let bg = CODE_COLORS[code];
  if (!bg) { let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; bg = `hsl(${h % 360} 60% 42%)`; }
  return { bg, fg: '#fff' };
}
function codePill(code) {
  const { bg, fg } = codeColor(code);
  const p = el('span', { class: 'code-pill' }, code);
  p.style.background = bg; p.style.color = fg;
  return p;
}

// ---- Assign Bahin: empty columns added this session + Thursday helper ----
const extraDates = { elder: new Set(), ms: new Set(), bible_reading: new Set(), female: new Set() };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// next midweek meeting date (Thursday): 7 days after the latest column, snapped
// to Thursday; or the upcoming Thursday when there are no columns yet.
function nextMeetingDate(dts) {
  let d;
  if (dts.length) { d = new Date(dts[dts.length - 1] + 'T00:00:00'); d.setDate(d.getDate() + 7); }
  else { d = new Date(); }
  d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7)); // snap forward to Thursday (day 4)
  return isoDate(d);
}

/* ----------------------------- data ----------------------------------- */
async function loadAll() {
  const grab = (t, order) => sb.from(t).select('*').order(order);
  const [m, mp, c, a, mt, pt] = await Promise.all([
    grab('members', 'sort'), grab('member_pools', 'member_id'),
    grab('part_codes', 'sort'), grab('assignments', 'meeting_date'),
    grab('meetings', 'sort'), grab('meeting_parts', 'pos'),
  ]);
  for (const r of [m, mp, c, a, mt, pt]) if (r.error) throw r.error;
  state.members = m.data; state.pools = mp.data; state.codes = c.data;
  state.assigns = a.data; state.meetings = mt.data; state.parts = pt.data;
}
const memberById = id => state.members.find(x => x.id === id);
const memberByName = nm => state.members.find(x => x.name === nm);
const poolsOf = id => state.pools.filter(p => p.member_id === id);
const codesForPool = pool => state.codes.filter(c => c.pool === pool);
const membersInPool = pool =>
  state.pools.filter(p => p.pool === pool)
    .map(p => ({ ...memberById(p.member_id), note: p.note }))
    .filter(Boolean)
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));

/* program-level fairness: how many program parts each name is assigned */
function programLoad() {
  const map = {};
  for (const p of state.parts) {
    for (const nm of [p.assignee, p.assistant]) if (nm) map[nm] = (map[nm] || 0) + 1;
  }
  return map;
}

/* =========================================================================
   VIEW: ESKEDYUL (prepare weekly program)
   ========================================================================= */
function viewEskedyul() {
  const root = $('#view'); root.innerHTML = '';
  root.append(el('div', { class: 'page-head' }, [
    el('h2', {}, 'Eskedyul sa Midweek nga Tigom'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => newMeeting() }, '+ New week'),
  ]));
  const meetings = [...state.meetings].sort((a, b) => (a.sort - b.sort) || (a.week_label || '').localeCompare(b.week_label || ''));
  if (!meetings.length) { root.append(el('p', { class: 'muted' }, 'No weeks yet — click “New week”.')); return; }
  const cards = el('div', { class: 'cards' });
  for (const mt of meetings) {
    cards.append(el('div', { class: 'card', onclick: () => editMeeting(mt.id) }, [
      el('h3', {}, mt.week_label || '(untitled)'),
      el('div', { class: 'rd' }, mt.reading || ''),
      el('div', { class: 'meta' }, [
        mt.is_special ? el('span', { class: 'chip warn' }, 'Walay tigom')
                      : el('span', { class: 'chip' }, 'Tsirman: ' + (mt.chairman || '—')),
      ]),
    ]));
  }
  root.append(cards);
}

async function newMeeting() {
  const { data, error } = await sb.from('meetings')
    .insert({ week_label: nextWeekLabel(), sort: (state.meetings.length + 1) * 10 }).select().single();
  if (error) return toast('Error: ' + error.message);
  // standard skeleton
  const skel = [
    ['INTRO', null, 'Introduksyon (1 min.)', null, null, null],
    ['BAHANDI', '1', '[Ulohan sa pakigpulong] (10 min.)', null, null, null],
    ['BAHANDI', '2', 'Espirituwal nga Bahandi (10 min.)', null, null, null],
    ['BAHANDI', '3', 'Pagbasa sa Bibliya (4 min.)', null, 'Estudyante', null],
    ['MAGMAEPEKTIBO', '4', 'Dihang Magsugod ug Panag-estorya (3 min.)', 'PAGPAMALAYBALAY', 'Estudyante', 'Assistant'],
    ['MAGMAEPEKTIBO', '5', 'Dihang Makig-estorya Pag-usab (4 min.)', 'IMPORMAL NGA PAGSANGYAW', 'Estudyante', 'Assistant'],
    ['MAGMAEPEKTIBO', '6', 'Dihang Maghimog Tinun-an (5 min.)', 'PAGPAMALAYBALAY', 'Estudyante', 'Assistant'],
    ['KRISTOHANONG PAGKINABUHI', null, 'Awit', null, null, null, true],
    ['KRISTOHANONG PAGKINABUHI', '7', '[Lokal nga mga Panginahanglan] (15 min.)', null, null, null],
    ['KRISTOHANONG PAGKINABUHI', '8', 'Pagtuon sa Kongregasyon sa Bibliya (30 min.)', null, 'Tigdumala', 'Tagabasa'],
    ['KONKLUSYON', null, 'Konklusyon (3 min.)', null, null, null],
    ['KONKLUSYON', null, 'Awit', null, null, null, true],
  ];
  const rows = skel.map((s, i) => ({
    meeting_id: data.id, pos: i, section: s[0], item_no: s[1], title: s[2],
    setting: s[3], assignee_role: s[4], assistant_role: s[5], is_song: !!s[6],
  }));
  await sb.from('meeting_parts').insert(rows);
  await loadAll();
  editMeeting(data.id);
}

function editMeeting(id) {
  const mt = state.meetings.find(m => m.id === id);
  if (!mt) return viewEskedyul();
  const parts = state.parts.filter(p => p.meeting_id === id).sort((a, b) => a.pos - b.pos)
    .map(p => ({ ...p }));              // working copy
  const load = programLoad();
  const names = state.members.map(m => m.name).sort();

  const root = $('#view'); root.innerHTML = '';
  // datalist for member suggestions
  const dl = el('datalist', { id: 'memberlist' }, names.map(n => el('option', { value: n })));
  root.append(dl);

  root.append(el('div', { class: 'page-head' }, [
    el('button', { class: 'btn ghost', onclick: () => viewEskedyul() }, '← Back'),
    el('h2', {}, mt.week_label || 'Week'),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn', onclick: () => printMeeting(mt, parts) }, '🖨 Print'),
    el('button', { class: 'btn primary', onclick: save }, 'Save'),
    el('button', { class: 'btn danger', onclick: del }, 'Delete'),
  ]));

  // ---- header fields ----
  const hdr = el('div', { class: 'panel' });
  const field = (label, key, type = 'text') => {
    const inp = el('input', { type, value: mt[key] ?? '' });
    inp.addEventListener('input', () => { mt[key] = inp.value; });
    return el('label', { class: 'field' }, [el('span', {}, label), inp]);
  };
  const grid2 = el('div', { class: 'row' });
  [['Semana (week label)', 'week_label'], ['Pagbasa sa Bibliya', 'reading'],
   ['Petsa (optional)', 'meeting_date', 'date'], ['Awit pangbukas', 'opening_song'],
   ['Tsirman', 'chairman'], ['Pag-ampo pangbukas', 'opening_prayer'],
   ['Pag-ampo panapos', 'closing_prayer']].forEach(f => {
    const w = el('div', { style: 'flex:1;min-width:200px' }, field(...f));
    grid2.append(w);
  });
  hdr.append(grid2);
  // special toggle
  const spWrap = el('div', { style: 'margin-top:8px' });
  const spChk = el('input', { type: 'checkbox' }); spChk.checked = !!mt.is_special;
  const spTxt = el('textarea', { rows: 3, style: 'width:100%;margin-top:6px', placeholder: 'e.g. WALAY MIDWEEK NGA TIGOM — SIRKITONG ASEMBLIYA…' }, mt.special_text || '');
  spTxt.style.display = mt.is_special ? 'block' : 'none';
  spTxt.addEventListener('input', () => mt.special_text = spTxt.value);
  spChk.addEventListener('change', () => { mt.is_special = spChk.checked; spTxt.style.display = spChk.checked ? 'block' : 'none'; });
  spWrap.append(el('label', { class: 'row' }, [spChk, el('span', {}, ' Special week (no midweek meeting / assembly)')]), spTxt);
  hdr.append(spWrap);
  root.append(hdr);

  // ---- parts editor ----
  const ed = el('div', { class: 'ed-grid' });
  function redraw() {
    ed.innerHTML = '';
    let lastSec = null;
    parts.forEach((p, idx) => {
      if (p.section !== lastSec) {
        lastSec = p.section;
        if (SECTION_TITLE[p.section]) ed.append(el('div', { class: 'sectionbar' }, SECTION_TITLE[p.section]));
      }
      ed.append(partRow(p, idx));
    });
    ed.append(el('button', { class: 'btn sm', style: 'margin-top:8px;justify-self:start', onclick: () => {
      parts.push({ section: 'MAGMAEPEKTIBO', item_no: '', title: '', is_song: false }); redraw();
    } }, '+ Add part'));
  }
  function partRow(p, idx) {
    const body = el('div', { class: 'body' });
    // line 1: number + title + setting
    const l1 = el('div', { class: 'ln' });
    const noInp = el('input', { value: p.item_no ?? '', style: 'width:42px', placeholder: '#' });
    noInp.addEventListener('input', () => p.item_no = noInp.value || null);
    const titleInp = el('input', { class: 'title', value: p.title ?? '', placeholder: p.is_song ? 'Awit __' : 'Ulohan sa bahin (min.)' });
    titleInp.addEventListener('input', () => p.title = titleInp.value);
    l1.append(noInp, titleInp);
    if (!p.is_song) {
      const setInp = el('input', { class: 'setting', value: p.setting ?? '', placeholder: 'SETTING (optional)' });
      setInp.addEventListener('input', () => p.setting = setInp.value.toUpperCase());
      l1.append(setInp);
    }
    body.append(l1);
    // line 2: assignee + assistant (not for songs)
    if (!p.is_song) {
      body.append(assignLine(p, 'assignee', 'assignee_role', load));
      if (p.assistant != null || p.assistant_role || /30 min|Panag-estorya|Makig-estorya|Maghimog|Pasundayag|Tinuohan|Pakigpulong \(.*min/.test(p.title || '') || p.assistant_role) {
        body.append(assignLine(p, 'assistant', 'assistant_role', load));
      } else {
        body.append(el('button', { class: 'btn sm', onclick: (e) => { p.assistant = ''; e.target.replaceWith(assignLine(p, 'assistant', 'assistant_role', load)); } }, '+ assistant/reader'));
      }
    }
    // controls
    const ctl = el('div', { class: 'ln' }, [
      el('button', { class: 'btn sm', onclick: () => { if (idx > 0) { [parts[idx-1], parts[idx]] = [parts[idx], parts[idx-1]]; redraw(); } } }, '↑'),
      el('button', { class: 'btn sm', onclick: () => { if (idx < parts.length-1) { [parts[idx+1], parts[idx]] = [parts[idx], parts[idx+1]]; redraw(); } } }, '↓'),
      el('select', { onchange: (e) => { p.section = e.target.value; redraw(); } },
        SECTION_ORDER.map(s => el('option', { value: s, ...(s === p.section ? { selected: '' } : {}) }, s))),
      el('button', { class: 'btn sm danger', onclick: () => { parts.splice(idx, 1); redraw(); } }, '✕'),
    ]);
    body.append(ctl);
    return el('div', { class: 'part' }, [el('div', { class: 'no' }, p.is_song ? '♪' : (p.item_no || '')), body]);
  }
  redraw();
  root.append(ed);

  function assignLine(p, field, roleField, load) {
    const roleTxt = p[roleField] || (field === 'assignee' ? 'Bahin' : 'Assistant');
    const inp = el('input', { class: 'pick', list: 'memberlist', value: p[field] ?? '', placeholder: 'Pangalan…' });
    const hint = el('span', { class: 'fairness' });
    const upd = () => { const n = load[inp.value]; hint.textContent = inp.value ? ('• ' + (n || 0) + ' bahin karon') : ''; };
    inp.addEventListener('input', () => { p[field] = inp.value; upd(); });
    upd();
    return el('div', { class: 'assignline' }, [el('span', { class: 'role' }, roleTxt + ':'), inp, hint]);
  }

  async function save() {
    const { error: e1 } = await sb.from('meetings').update({
      week_label: mt.week_label, reading: mt.reading, meeting_date: mt.meeting_date || null,
      is_special: !!mt.is_special, special_text: mt.special_text || null,
      chairman: mt.chairman, opening_prayer: mt.opening_prayer, closing_prayer: mt.closing_prayer,
      opening_song: mt.opening_song,
    }).eq('id', id);
    if (e1) return toast('Error: ' + e1.message);
    await sb.from('meeting_parts').delete().eq('meeting_id', id);
    const rows = parts.map((p, i) => ({
      meeting_id: id, pos: i, section: p.section, item_no: p.item_no || null, title: p.title || null,
      setting: p.setting || null, assignee: p.assignee || null, assignee_role: p.assignee_role || null,
      assistant: p.assistant || null, assistant_role: p.assistant_role || null, is_song: !!p.is_song,
    }));
    if (rows.length) { const { error: e2 } = await sb.from('meeting_parts').insert(rows); if (e2) return toast('Error: ' + e2.message); }
    await loadAll(); toast('Saved ✓'); viewEskedyul();
  }
  async function del() {
    if (!confirm('Delete this week’s program?')) return;
    await sb.from('meetings').delete().eq('id', id);
    await loadAll(); toast('Deleted'); viewEskedyul();
  }
}

/* ---- printable sheet (A4, matches the posted layout) ---- */
const SEC_COLOR = { BAHANDI: '#2b5ba7', MAGMAEPEKTIBO: '#c0601f', 'KRISTOHANONG PAGKINABUHI': '#c21f24' };
const BARRED = new Set(['BAHANDI', 'MAGMAEPEKTIBO', 'KRISTOHANONG PAGKINABUHI']);
function meetingSheetHTML(mt, parts) {
  const h = [];
  const preRow = (text, bold) => `<tr><td class="num"></td><td colspan="3" class="pre${bold ? ' song' : ''}">${esc(text)}</td></tr>`;
  const nmRow = (num, title, titleCls, role, name) =>
    `<tr><td class="num">${esc(num || '')}</td><td class="ttl2 ${titleCls || ''}">${esc(title || '')}</td>` +
    `<td class="role">${esc(role || '')}</td><td class="nm2">${esc(name || '')}</td></tr>`;

  h.push('<div class="sheet">');
  h.push('<div class="hdr"><div class="cong">PROPER STA. FE CONGREGATION</div><div class="ttl">ESKEDYUL SA MIDWEEK NGA TIGOM</div></div>');

  h.push('<div class="meta"><div class="left">');
  h.push(`<div class="wk">${esc(mt.week_label || '')}</div>`);
  if (mt.reading) h.push(`<div class="rd">${esc(mt.reading)}</div>`);
  h.push('</div>');
  if (!mt.is_special) {
    h.push('<div class="right">');
    h.push(`<div class="fld"><span class="lbl">Tsirman:</span><span class="nm">${esc(mt.chairman || '')}</span></div>`);
    h.push(`<div class="fld"><span class="lbl">Pag-ampo:</span><span class="nm">${esc(mt.opening_prayer || '')}</span></div>`);
    h.push('</div>');
  }
  h.push('</div>');

  if (mt.is_special) {
    h.push(`<div class="special">${esc(mt.special_text || 'WALAY MIDWEEK NGA TIGOM').replace(/\n/g, '<br>')}</div></div>`);
    return h.join('');
  }

  h.push('<table class="prog">');
  if (mt.opening_song) h.push(preRow(mt.opening_song, true));
  let lastSec = null;
  for (const p of parts) {
    if (BARRED.has(p.section) && p.section !== lastSec) {
      h.push(`<tr><td colspan="4"><div class="secbar" style="background:${SEC_COLOR[p.section]}">${esc(SECTION_TITLE[p.section])}</div></td></tr>`);
    }
    lastSec = p.section;

    if (p.is_song) {
      if (p.section === 'KONKLUSYON' && mt.closing_prayer)
        h.push(nmRow('', p.title || 'Awit', 'song', 'Pag-ampo:', mt.closing_prayer));
      else h.push(preRow(p.title || 'Awit', true));
      continue;
    }
    if (!p.item_no) { h.push(preRow(p.title || '', false)); continue; }

    h.push(nmRow(p.item_no, p.title, '', p.assignee_role ? p.assignee_role + ':' : '', p.assignee));
    if (p.setting || p.assistant)
      h.push(nmRow('', p.setting || '', 'setting', p.assistant ? (p.assistant_role || 'Assistant') + ':' : '', p.assistant || ''));
  }
  h.push('</table></div>');
  return h.join('');
}
function printMeeting(mt, parts) {
  $('#print-root').innerHTML = meetingSheetHTML(mt, [...parts].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0)));
  window.print();
}

/* =========================================================================
   VIEW: ASSIGN BAHIN (scheduler grid)
   ========================================================================= */
let gridPool = 'elder';
function viewAssign() {
  const root = $('#view'); root.innerHTML = '';
  root.append(el('div', { class: 'page-head' }, [
    el('h2', {}, 'Assign Bahin'),
    el('div', { class: 'spacer' }),
    el('div', { class: 'row' }, POOLS.map(p =>
      el('button', { class: 'tab' + (p.key === gridPool ? ' active' : ''), onclick: () => { gridPool = p.key; viewAssign(); } }, p.label))),
  ]));

  const dates = [...new Set([
    ...state.assigns.filter(a => a.pool === gridPool).map(a => a.meeting_date),
    ...extraDates[gridPool],
  ])].sort();
  const members = membersInPool(gridPool);
  const cell = (mid, d) => state.assigns.find(a => a.member_id === mid && a.pool === gridPool && a.meeting_date === d);

  const bar = el('div', { class: 'panel row' }, [
    el('span', { class: 'hint' }, `${members.length} eligible · ${dates.length} weeks · click a cell to assign`),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', onclick: addWeek }, '+ Add week'),
    el('button', { class: 'btn sm', onclick: addToPool }, '+ Add member'),
  ]);
  root.append(bar);

  const tbl = el('table', { class: 'grid' });
  // header
  const thr = el('tr', {}, [el('th', { class: 'name' }, 'ELIGIBLES'), el('th', {}, 'Σ')]);
  let lastMonth = null;
  for (const d of dates) {
    const mo = fmtMonth(d);
    const th = el('th', { class: 'datehdr', title: 'I-klik aron usbon ang petsa', onclick: () => editColumnDate(d) }, fmtShort(d));
    if (mo !== lastMonth) { th.classList.add('month-sep'); th.title = mo + ' · i-klik aron usbon'; lastMonth = mo; }
    thr.append(th);
  }
  tbl.append(el('thead', {}, thr));
  // body
  const tb = el('tbody');
  for (const mb of members) {
    const total = state.assigns.filter(a => a.member_id === mb.id && a.pool === gridPool).length;
    const tr = el('tr', {}, [
      el('td', { class: 'name', title: mb.note || '' }, [mb.name, mb.note ? el('span', { class: 'sub' }, mb.note) : null]),
      el('td', { class: 'cnt' }, String(total)),
    ]);
    for (const d of dates) {
      const c = cell(mb.id, d);
      const td = el('td', { class: 'cell' });
      if (c && c.code) td.append(codePill(c.code));
      td.addEventListener('click', () => pickCode(mb, d, c));
      tr.append(td);
    }
    tb.append(tr);
  }
  tbl.append(tb);
  root.append(el('div', { class: 'gridwrap' }, tbl));

  function pickCode(mb, d, existing) {
    const codes = codesForPool(gridPool);
    const bg = el('div', { class: 'modal-bg' });
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    const counts = Object.fromEntries(codes.map(c =>
      [c.code, state.assigns.filter(a => a.member_id === mb.id && a.pool === gridPool && a.code === c.code).length]));
    const btns = el('div', { class: 'codebtns' }, codes.map(c =>
      el('button', { onclick: async () => { await setCell(mb.id, d, c.code); close(); } },
        [codePill(c.code), ' ', el('span', { class: 'fairness' }, `(${counts[c.code]})`)])));
    const m = el('div', { class: 'modal' }, [
      el('h3', {}, `${mb.name} — ${fmtShort(d)}`),
      el('div', { class: 'hint' }, POOL_LABEL[gridPool] + ' · number in () = times already given this code'),
      btns,
      el('div', { class: 'row' }, [
        existing ? el('button', { class: 'btn danger', onclick: async () => { await clearCell(mb.id, d); close(); } }, 'Clear') : null,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn', onclick: close }, 'Cancel'),
      ]),
    ]);
    bg.append(m); document.body.append(bg);
  }
  async function setCell(mid, d, code) {
    const { error } = await sb.from('assignments')
      .upsert({ member_id: mid, pool: gridPool, meeting_date: d, code }, { onConflict: 'member_id,pool,meeting_date' });
    if (error) return toast('Error: ' + error.message);
    await loadAll(); viewAssign();
  }
  async function clearCell(mid, d) {
    await sb.from('assignments').delete().match({ member_id: mid, pool: gridPool, meeting_date: d });
    await loadAll(); viewAssign();
  }
  // auto-add the next Thursday as a new (empty) column — no prompt
  function addWeek() {
    const next = nextMeetingDate(dates);
    if (dates.includes(next)) { toast('Naa na: ' + fmtShort(next)); return; }
    extraDates[gridPool].add(next);
    toast('Gidugang: ' + fmtShort(next));
    viewAssign();
  }
  // click a column date to change it (moves any assignments in that column)
  async function editColumnDate(oldDate) {
    const v = prompt('Petsa sa tigom (YYYY-MM-DD):', oldDate);
    if (v == null) return;
    const nv = v.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nv)) { toast('Format: YYYY-MM-DD'); return; }
    if (nv === oldDate) return;
    if (dates.includes(nv)) { toast('Naa nay petsa nga ' + fmtShort(nv)); return; }
    const { error } = await sb.from('assignments').update({ meeting_date: nv })
      .match({ pool: gridPool, meeting_date: oldDate });
    if (error) return toast('Error: ' + error.message);
    const s = extraDates[gridPool]; if (s.has(oldDate)) { s.delete(oldDate); s.add(nv); }
    await loadAll(); viewAssign();
  }
  async function addToPool() {
    const name = prompt('Member name (existing or new):'); if (!name) return;
    let mb = memberByName(name.trim());
    if (!mb) { const { data } = await sb.from('members').insert({ name: name.trim(), sort: state.members.length }).select().single(); mb = data; }
    await sb.from('member_pools').upsert({ member_id: mb.id, pool: gridPool }, { onConflict: 'member_id,pool' });
    await loadAll(); viewAssign();
  }
}

/* =========================================================================
   VIEW: MEMBERS
   ========================================================================= */
function viewMembers() {
  const root = $('#view'); root.innerHTML = '';
  root.append(el('div', { class: 'page-head' }, [
    el('h2', {}, 'Members'), el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: () => editMember(null) }, '+ Add member'),
  ]));
  const tbl = el('table', { class: 'list' });
  tbl.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Name'), el('th', {}, 'Pools'), el('th', {}, 'Active'), el('th', {}, '')])));
  const tb = el('tbody');
  for (const mb of [...state.members].sort((a, b) => a.name.localeCompare(b.name))) {
    const chips = poolsOf(mb.id).map(p => el('span', { class: 'chip', title: p.note || '' }, POOL_LABEL[p.pool] + (p.note ? ' *' : '')));
    tb.append(el('tr', {}, [
      el('td', {}, mb.name),
      el('td', {}, el('div', { class: 'row' }, chips.length ? chips : [el('span', { class: 'muted' }, '—')])),
      el('td', {}, mb.active ? '✓' : '—'),
      el('td', {}, el('button', { class: 'btn sm', onclick: () => editMember(mb.id) }, 'Edit')),
    ]));
  }
  tbl.append(tb); root.append(el('div', { class: 'panel' }, tbl));
}
function editMember(id) {
  const mb = id ? state.members.find(m => m.id === id) : { name: '', active: true };
  const myPools = id ? poolsOf(id) : [];
  const bg = el('div', { class: 'modal-bg' }); const close = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  const nameInp = el('input', { value: mb.name }); const actChk = el('input', { type: 'checkbox' }); actChk.checked = mb.active;
  const poolRows = POOLS.map(p => {
    const found = myPools.find(x => x.pool === p.key);
    const chk = el('input', { type: 'checkbox' }); chk.checked = !!found;
    const note = el('input', { value: found?.note || '', placeholder: 'note e.g. ENB only' });
    return { p, chk, note, row: el('label', { class: 'row', style: 'margin:4px 0' }, [chk, el('span', { style: 'min-width:190px' }, p.label), note]) };
  });
  const m = el('div', { class: 'modal' }, [
    el('h3', {}, id ? 'Edit member' : 'Add member'),
    el('label', { class: 'field' }, [el('span', {}, 'Name'), nameInp]),
    el('div', {}, poolRows.map(r => r.row)),
    el('label', { class: 'row', style: 'margin-top:6px' }, [actChk, el('span', {}, ' Active')]),
    el('div', { class: 'row', style: 'margin-top:12px' }, [
      id ? el('button', { class: 'btn danger', onclick: async () => { if (confirm('Delete member and all their data?')) { await sb.from('members').delete().eq('id', id); await loadAll(); close(); viewMembers(); } } }, 'Delete') : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: close }, 'Cancel'),
      el('button', { class: 'btn primary', onclick: save }, 'Save'),
    ]),
  ]);
  bg.append(m); document.body.append(bg);
  async function save() {
    const name = nameInp.value.trim(); if (!name) return toast('Name required');
    let mid = id;
    if (id) await sb.from('members').update({ name, active: actChk.checked }).eq('id', id);
    else { const { data, error } = await sb.from('members').insert({ name, active: actChk.checked, sort: state.members.length }).select().single(); if (error) return toast('Error: ' + error.message); mid = data.id; }
    for (const r of poolRows) {
      if (r.chk.checked) await sb.from('member_pools').upsert({ member_id: mid, pool: r.p.key, note: r.note.value.trim() || null }, { onConflict: 'member_id,pool' });
      else await sb.from('member_pools').delete().match({ member_id: mid, pool: r.p.key });
    }
    await loadAll(); close(); toast('Saved ✓'); viewMembers();
  }
}

/* =========================================================================
   VIEW: LEGEND (part codes)
   ========================================================================= */
function viewLegend() {
  const root = $('#view'); root.innerHTML = '';
  root.append(el('div', { class: 'page-head' }, [el('h2', {}, 'Legend — Part codes'), el('div', { class: 'spacer' }),
    el('button', { class: 'btn primary', onclick: addCode }, '+ Add code')]));
  for (const pool of POOLS) {
    const codes = codesForPool(pool.key); if (!codes.length) continue;
    const tbl = el('table', { class: 'list' });
    tbl.append(el('thead', {}, el('tr', {}, [el('th', { style: 'width:70px' }, 'Code'), el('th', {}, 'Label'), el('th', { style: 'width:40px' }, '')])));
    const tb = el('tbody');
    for (const c of codes) {
      const inp = el('input', { value: c.label, style: 'width:100%' });
      inp.addEventListener('change', async () => { await sb.from('part_codes').update({ label: inp.value, needs_review: false }).eq('id', c.id); c.label = inp.value; toast('Saved ✓'); });
      tb.append(el('tr', {}, [
        el('td', {}, [codePill(c.code), c.needs_review ? el('span', { class: 'chip warn', style: 'margin-left:4px' }, '?') : null]),
        el('td', {}, inp),
        el('td', {}, el('button', { class: 'btn sm danger', onclick: async () => { if (confirm('Delete code ' + c.code + '?')) { await sb.from('part_codes').delete().eq('id', c.id); await loadAll(); viewLegend(); } } }, '✕')),
      ]));
    }
    tbl.append(tb);
    root.append(el('div', { class: 'panel' }, [el('h3', { style: 'margin:.2em 0 .5em' }, pool.label), tbl]));
  }
  async function addCode() {
    const pool = prompt('Pool (elder / ms / bible_reading / female):'); if (!POOL_LABEL[pool]) return toast('Unknown pool');
    const code = prompt('Code (e.g. KP1):'); if (!code) return;
    const label = prompt('Label:') || code;
    await sb.from('part_codes').insert({ pool, code: code.trim(), label, sort: state.codes.length }); await loadAll(); viewLegend();
  }
}

/* ----------------------------- router --------------------------------- */
function render() {
  $$('.tab[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === currentView));
  ({ eskedyul: viewEskedyul, assign: viewAssign, members: viewMembers, legend: viewLegend }[currentView] || viewEskedyul)();
}

/* ----------------------------- boot ----------------------------------- */
function makeClient(url, key) {
  return window.supabase.createClient(url, key, { db: { schema: (window.MW_CONFIG?.schema) || 'midweek' } });
}
async function boot() {
  // theme
  const savedTheme = localStorage.getItem('mw_theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  $('#theme-btn')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; localStorage.setItem('mw_theme', next);
  });
  $$('.tab[data-view]').forEach(t => t.addEventListener('click', () => { currentView = t.dataset.view; render(); }));

  const cfg = window.MW_CONFIG || {};
  const url = cfg.url || localStorage.getItem('mw_url');
  const key = cfg.key || localStorage.getItem('mw_key');
  if (!url || !key) return showSetup();
  try {
    sb = makeClient(url, key);
    await loadAll();
    $('#app').classList.remove('hidden');
    render();
  } catch (e) {
    console.error(e);
    showSetup('Could not connect / load: ' + (e.message || e) + '  — check the SQL ran and the midweek schema is exposed.');
  }
}
function showSetup(msg) {
  $('#setup-screen').classList.remove('hidden');
  if (msg) $('#cfg-msg').textContent = msg;
  $('#cfg-url').value = window.MW_CONFIG?.url || '';
  $('#cfg-save').onclick = async () => {
    const url = $('#cfg-url').value.trim(), key = $('#cfg-key').value.trim();
    if (!url || !key) return;
    localStorage.setItem('mw_url', url); localStorage.setItem('mw_key', key);
    location.reload();
  };
}
boot();
