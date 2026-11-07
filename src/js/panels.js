// panels.js — rarely used surfaces, loaded on demand (settings, pairing, shortcuts, import/export).
// No imports on purpose: dependencies are passed in by install(), so the bundler can't hoist shared
// modules into an extra chunk on the critical path. The service worker precaches this file.
let S, O, A, DB, st, h, renderPage, renderSide, commands, pretty, ui, open, close, phone;
export function install(d) {
  ({ S, O, A, DB, st, h, renderPage, renderSide, commands, pretty, ui, open, close, phone } = d);
  wire();
}
function wire() {
/* ---------------- cheat sheet ---------------- */
ui.cheat = () => {
  const groups = {};
  for (const c of commands) { if (c.hidden || !c.keys.length) continue; (groups[c.group] ||= []).push(c); }
  const typing = [['Enter', 'New item (splits at the caret)'], ['Shift+Enter', 'Edit notes'], ['Tab', 'Indent'], ['Shift+Tab', 'Outdent'], ['Backspace', 'Join with the item above (at the start)'], ['Escape', 'Stop typing']];
  const panel = h('section', { class: 'cheat' },
    h('h2', null, 'Keyboard'),
    h('div', { class: 'cols' },
      h('div', { class: 'grp' }, h('h3', null, 'While typing'), ...typing.map(([k, l]) => h('div', { class: 'kr' }, h('span', null, l), h('kbd', null, pretty(k))))),
      ...Object.entries(groups).map(([g, cs]) => h('div', { class: 'grp' }, h('h3', null, g), ...cs.map((c) => h('div', { class: 'kr' }, h('span', null, c.label), h('span', { class: 'ks' }, ...c.keys.slice(0, 2).map((k) => h('kbd', null, pretty(k))))))))));
  open(panel, { kind: phone() ? 'sheet' : 'modal', label: 'Keyboard shortcuts' });
};

/* ---------------- settings ---------------- */
ui.settings = async () => {
  const panel = h('section', { class: 'settings' });
  const entry = open(panel, { kind: phone() ? 'sheet' : 'modal', label: 'Settings' });
  const draw = async () => {
    const theme = localStorage.getItem('lists.theme') || 'system';
    const persisted = await DB.persisted();
    const ss = ui.syncState ? ui.syncState() : null;
    const code = ui.pairingCode ? await ui.pairingCode() : null;
    const seg = (name, cur, opts, on) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name }, ...opts.map(([v, l]) => h('button', { role: 'radio', 'aria-checked': String(cur === v), class: cur === v ? 'on' : '', onclick: () => { on(v); draw(); } }, l)));
    const age = ss && ss.lastPush ? relAge(Date.now() - ss.lastPush) : 'never';
    const days = DB.getMeta('backupDays') ?? 3;
    panel.replaceChildren(
      h('h2', null, 'Settings'),
      h('div', { class: 'srow' }, h('span', { class: 'k' }, 'Theme'), seg('Theme', theme, [['system', 'System'], ['paper', 'Paper'], ['graphite', 'Graphite']], (v) => ui.setTheme(v))),
      h('h3', null, 'Backup & sync'),
      code
        ? h('div', { class: 'sblock' },
          h('p', null, `Encrypted backup is on. Last backed up ${age}.`, ss && ss.message ? h('span', { class: 'muted' }, ' ' + ss.message) : null),
          h('div', { class: 'srow' }, h('span', { class: 'k' }, 'Sync on Wi-Fi'), seg('Sync cadence', DB.getMeta('syncEvery') || 0, [[0, 'As you go'], [1, 'Daily'], [3, 'Every 3 days'], [7, 'Weekly']], (v) => DB.setMeta('syncEvery', v || null))),
          h('div', { class: 'srow' }, h('span', { class: 'k' }, 'On mobile data after'), seg('Backup age', days, [[1, '1 day'], [3, '3 days'], [7, '7 days']], (v) => DB.setMeta('backupDays', v))),
          h('p', { class: 'muted' }, 'Lists stays on this device and syncs only on Wi-Fi or a fast connection, on the cadence above. If the server copy is older than the second setting and you have unsent changes, it syncs on any connection except 2G or Data Saver.'),
          h('div', { class: 'acts' },
            h('button', { class: 'btn', onclick: () => ui.syncNow() }, 'Sync now'),
            h('button', { class: 'btn', onclick: () => showCode(code) }, 'Pair another device'),
            h('button', { class: 'btn danger', onclick: async () => { if (confirm('Stop syncing on this device? Your items stay here.')) { await ui.unpair(); draw(); } } }, 'Turn off')))
        : h('div', { class: 'sblock' },
          h('p', null, 'Your lists live on this device. Turn on backup to keep an end-to-end encrypted copy on the server and sync it to your other devices. The server only ever sees ciphertext.'),
          h('div', { class: 'acts' },
            h('button', { class: 'btn primary', onclick: async () => { try { const c = await ui.createVault(); draw(); showCode(c); } catch (e) { ui.toast('Could not reach the server'); } } }, 'Turn on backup'),
            h('button', { class: 'btn', onclick: () => joinPrompt(draw) }, 'I have a pairing code'))),
      h('h3', null, 'Storage'),
      h('p', { class: 'muted' }, persisted ? 'This browser has marked your data as persistent, so it won’t be cleared to save space.' : 'Your data is stored on this device. Installing Lists as an app makes it less likely the browser will ever clear it.'),
      persisted ? null : h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: async () => { const ok = await DB.askPersist(); ui.toast(ok ? 'Storage is now persistent' : 'The browser declined for now'); draw(); } }, 'Make storage persistent')),
      h('h3', null, 'Your data'),
      h('div', { class: 'acts' },
        h('button', { class: 'btn', onclick: () => ui.exportMd() }, 'Export Markdown'),
        h('button', { class: 'btn', onclick: () => ui.exportJson() }, 'Export backup (JSON)'),
        h('button', { class: 'btn', onclick: () => ui.importFile() }, 'Import…'),
        h('button', { class: 'btn', onclick: () => ui.importFile('restore') }, 'Restore from backup…')),
      ui.install ? h('div', { class: 'acts' }, h('button', { class: 'btn primary', onclick: () => { ui.install(); draw(); } }, 'Install Lists as an app')) : null,
      h('h3', null, 'Help'),
      h('div', { class: 'acts' }, h('button', { class: 'btn', onclick: () => { close(entry); ui.cheat(); } }, 'Keyboard shortcuts'), h('button', { class: 'btn', onclick: () => { close(entry); ui.tutorial && ui.tutorial(); } }, 'Add the tour to Today')),
      h('p', { class: 'muted small' }, `Lists ${window.LISTS_VERSION || ''}, ${S.recs.size} records. Open source.`),
      // Device facts for tuning the two target layouts (PLAN §10): read them off the real phone and Mac.
      h('p', { class: 'muted small', id: 'devinfo' }, `This device: ${innerWidth}×${innerHeight} CSS px, screen ${screen.width}×${screen.height}, ${devicePixelRatio}× pixels${matchMedia('(color-gamut: p3)').matches ? ', P3 colour' : ''}${navigator.connection ? ', ' + (navigator.connection.type || navigator.connection.effectiveType) : ''}.`),
    );
  };
  draw();
};
function relAge(ms) {
  const m = Math.round(ms / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}
function showCode(code) {
  const link = location.origin + '/#pair=' + code.replace(/[\s-]/g, '');
  const panel = h('section', { class: 'pair' },
    h('h2', null, 'Pair a device'),
    h('p', null, 'On your other device, open Lists → Settings → “I have a pairing code” and enter:'),
    h('code', { class: 'code' }, code),
    h('p', { class: 'muted' }, 'Or open this link there. Anyone with the code can read your lists, so share it only with yourself.'),
    h('div', { class: 'acts' },
      h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(code); ui.toast('Code copied'); } }, 'Copy code'),
      h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(link); ui.toast('Link copied'); } }, 'Copy link'),
      navigator.share ? h('button', { class: 'btn', onclick: () => navigator.share({ title: 'Lists pairing link', url: link }).catch(() => {}) }, 'Share…') : null));
  open(panel, { label: 'Pairing code' });
}
function joinPrompt(after) {
  const input = h('input', { class: 'code-in', placeholder: 'XXXX-XXXX-…', 'aria-label': 'Pairing code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const go = async () => { try { await ui.join(input.value); close(entry); ui.toast('Paired. Syncing…'); after && after(); } catch (e) { ui.toast('That code didn’t work'); } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const panel = h('section', { class: 'pair' }, h('h2', null, 'Enter pairing code'), input, h('div', { class: 'acts' }, h('button', { class: 'btn primary', onclick: go }, 'Pair')));
  const entry = open(panel, { label: 'Enter pairing code' });
  setTimeout(() => input.focus(), 20);
}

/* ---------------- import / export ---------------- */
function download(name, text, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
ui.exportMd = () => { download(`lists-${A.today()}.md`, toMarkdown(), 'text/markdown'); ui.toast('Exported Markdown'); };
ui.exportJson = () => { download(`lists-backup-${A.today()}.json`, JSON.stringify({ app: 'lists', v: 1, records: S.allRecords() }), 'application/json'); ui.toast('Exported backup'); };
ui.importFile = (mode = 'merge') => {
  const inp = h('input', { type: 'file', accept: '.json,.md,.txt,text/plain,application/json' });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const text = await f.text();
    try {
      if (/^\s*\{/.test(text)) {
        const j = JSON.parse(text);
        if (!j || !Array.isArray(j.records)) throw new Error('bad');
        const recs = j.records.filter(validRecord);
        if (mode === 'restore') {
          // Restore: re-write every field with a fresh stamp so the backup wins over newer edits and
          // deletions. One undo step; it syncs like any edit (req-trust-touch-19).
          ui.restoreRecords(recs);
          ui.toast(`Restored ${recs.length} records`, { undo: true });
        } else {
          const n = S.mergeRemote(recs);
          for (const r of recs) if (S.recs.has(r.id)) DB.put(S.recs.get(r.id), true);
          ui.toast(recs.length < j.records.length ? `Merged ${n} records, skipped ${j.records.length - recs.length} invalid` : `Merged ${n} records`);
        }
      } else {
        const lists = importMarkdown(text, f.name.replace(/\.\w+$/, ''));
        if (lists[0]) ui.go({ view: 'node', id: lists[0] }, 'key');
        ui.toast(lists.length === 1 ? 'Imported 1 list' : `Imported ${lists.length} lists`, { undo: true });
      }
      renderPage(); renderSide();
    } catch { ui.toast('Couldn’t read that file'); }
  });
  inp.click();
};

/** Import guard (audit S3-7): ids, field shapes, dates and stamps must be sane before they can sync everywhere. */
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HLC = /^[0-9a-z]{9}\.[0-9a-z]{4}\.[\w-]{1,24}$/;
function validRecord(r) {
  if (!r || typeof r.id !== 'string' || r.id.length > 64 || !r.f || typeof r.f !== 'object') return false;
  const horizon = Date.now() + 864e5;
  for (const k in r.f) {
    const e = r.f[k];
    if (!Array.isArray(e) || e.length !== 2 || !HLC.test(e[1]) || parseInt(e[1].slice(0, 9), 36) > horizon) return false;
    const v = e[0];
    if ((k === 'when' || k === 'deadline') && v !== null && !YMD.test(v)) return false;
    if ((k === 'title' || k === 'notes') && typeof v !== 'string') return false;
    if (k === 'pos' && (v === null || typeof v !== 'object' || typeof v.parent !== 'string' || typeof v.key !== 'string')) return false;
  }
  return true;
}
}

// Markdown import/export (moved from actions.js: only Settings uses them, so they load lazily).
/* -------- Markdown import (reads what toMarkdown writes: # lists, - [ ] items, **headings**, <!-- dates -->, > notes) -------- */
function importMarkdown(text, fallbackTitle) {
  const blocks = [];
  let cur = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const hm = line.match(/^#\s+(.*)$/);
    if (hm) { cur = { title: hm[1].trim(), lines: [] }; blocks.push(cur); continue; }
    if (!cur) { cur = { title: fallbackTitle || 'Imported', lines: [] }; blocks.push(cur); }
    cur.lines.push(line);
  }
  const made = [];
  O.tx('Import', () => {
    for (const b of blocks) {
      if (!b.lines.some((l) => l.trim()) && b.title === (fallbackTitle || 'Imported')) continue;
      // The exported Inbox section goes back into the Inbox rather than becoming a list named "Inbox".
      const list = b.title === 'Inbox' ? S.INBOX : O.create({ title: b.title, pos: S.posAt(S.ROOT, S.children(S.ROOT).length) });
      if (list !== S.INBOX) made.push(list);
      // Pull notes ("> …") and date comments off before outline parsing, keyed by the item line they follow.
      const items = [], extras = [];
      for (const l of b.lines) {
        const note = l.match(/^\s*>\s?(.*)$/);
        if (note && items.length) { (extras[items.length - 1] ||= { notes: [] }).notes.push(note[1]); continue; }
        if (!l.trim()) continue;
        const meta = l.match(/<!--\s*(.*?)\s*-->/);
        let line = l.replace(/\s*<!--.*?-->\s*$/, '');
        const head = line.match(/^(\s*)-\s+\*\*(.+)\*\*\s*$/);
        if (head) line = head[1] + '- ' + head[2];
        items.push(line);
        const x = (extras[items.length - 1] ||= { notes: [] });
        if (head) x.heading = true;
        if (meta) { const w = meta[1].match(/when:(\d{4}-\d{2}-\d{2})/), d = meta[1].match(/due:(\d{4}-\d{2}-\d{2})/); if (w) x.when = w[1]; if (d) x.deadline = d[1]; }
      }
      const ids = A.pasteOutline(items.join('\n'), list, list === S.INBOX ? S.children(S.INBOX).length : 0);
      ids.forEach((id, i) => {
        const x = extras[i];
        if (!x) return;
        const f = {};
        if (x.notes.length) f.notes = x.notes.join('\n');
        if (x.heading) f.heading = true;
        if (x.when) f.when = x.when;
        if (x.deadline) f.deadline = x.deadline;
        if (Object.keys(f).length) O.set(id, f);
      });
    }
  }, { ctx: { route: { ...st.route }, sel: st.cursor } });
  return made;
}

/* -------- export -------- */
function toMarkdown(rootId = S.ROOT) {
  const out = [];
  const walk = (p, d) => {
    for (const c of S.children(p)) {
      if (S.val(c, 'kind') === 'log') continue;
      const t = S.val(c, 'title');
      const head = S.val(c, 'heading');
      const meta = [];
      if (S.val(c, 'when')) meta.push('when:' + S.val(c, 'when'));
      if (S.val(c, 'deadline')) meta.push('due:' + S.val(c, 'deadline'));
      const line = (head ? '- **' + t + '**' : '- [' + (S.val(c, 'done') ? 'x' : ' ') + '] ' + t) + (meta.length ? '  <!-- ' + meta.join(' ') + ' -->' : '');
      if (d === 0 && p === S.ROOT) { out.push('', '# ' + (t || 'Untitled'), ''); walk(c, 0.5); continue; }
      out.push('  '.repeat(Math.floor(d)) + line);
      const n = S.val(c, 'notes');
      if (n) out.push(...n.split('\n').map((l) => '  '.repeat(Math.floor(d) + 1) + '> ' + l));
      walk(c, Math.floor(d) + 1);
    }
  };
  walk(rootId, 0);
  return out.join('\n').trim() + '\n';
}
