const $ = id => document.getElementById(id);
let subs = [], cur = null, lastTotal = -1, hideT, rT;
let running = new Set(), prog = {}, previewing = false, pvCount = 0;

function line(text, cls = '') {
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  const l = $('log'); l.appendChild(d); l.scrollTop = l.scrollHeight;
  while (l.childNodes.length > 1500) l.removeChild(l.firstChild);
}
const ago = t => { if (!t) return 'never checked'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

// ---- progress panel ----
function showProg(text, pct, done) {
  $('prog').hidden = false;
  const f = $('barfill');
  f.parentElement.classList.toggle('ind', pct == null && !done);
  f.style.width = (done ? 100 : pct == null ? 30 : pct) + '%';
  $('progText').textContent = text;
}
const hideProg = () => { $('prog').hidden = true; };
function paintProg(p) {
  const q = p.queued ? ` · ${p.queued} more queued` : '';
  showProg(`Syncing… ${p.downloaded || 0} new · ${p.skipped || 0} already saved${p.current ? ' · ' + p.current : ''}${q}`, p.pct);
}

// ---- sidebar ----
function renderSubs() {
  const box = $('subs'); box.textContent = '';
  for (const s of subs) {
    const d = document.createElement('div'); d.className = 's' + (s.id === cur ? ' on' : '');
    d.innerHTML = '<div><b></b><i></i></div><span class="dot"></span>';
    d.querySelector('b').textContent = s.name;
    const p = prog[s.id];
    d.querySelector('i').textContent = running.has(s.id)
      ? `Syncing… ${p ? p.downloaded : 0} new`
      : `${s.host} · ${s.count} files · ${ago(s.last)}`;
    d.querySelector('.dot').classList.toggle('run', running.has(s.id));
    d.onclick = () => select(s.id);
    box.appendChild(d);
  }
}
const soon = () => { if (!rT) rT = setTimeout(() => { rT = null; renderSubs(); }, 500); };

// ---- grid ----
function addThumb(it, kind) {
  const d = document.createElement('div'); d.className = 'th'; d.title = it.label;
  if (it.src && kind === 'file' && it.video) {
    const v = document.createElement('video'); v.src = it.src + '#t=0.1'; v.muted = true; v.preload = 'metadata'; d.appendChild(v);
  } else if (it.src) {
    const img = document.createElement('img'); img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = it.src;
    img.onerror = () => { img.remove(); d.append(it.video ? '🎬' : '🖼️'); }; d.appendChild(img);
  } else d.textContent = it.video ? '🎬' : '🖼️';
  if (it.video) { const b = document.createElement('span'); b.className = 'b'; b.textContent = '▶'; d.appendChild(b); }
  if (kind === 'file') d.onclick = () => api.openPath(it.path);
  $('grid').appendChild(d);
}
function thumbs(items, kind) {
  $('grid').textContent = ''; $('empty').hidden = items.length > 0;
  items.forEach(it => addThumb(it, kind));
}
function header(title, sub, own) {
  $('title').textContent = title; $('sub').textContent = sub || '';
  for (const id of ['check', 'folder', 'remove']) $(id).hidden = !own;
  $('stop').hidden = !(running.size || previewing);
}

async function refreshGallery(force) {
  if (!cur) return;
  const m = await api.media(cur);
  if (!force && m.total === lastTotal) return;
  lastTotal = m.total; thumbs(m.items, 'file');
  $('empty').textContent = running.has(cur) ? 'Downloading… files appear here as they arrive.' : 'No files yet. Press Check now.';
  if (m.total > 300) $('sub').textContent = `showing newest 300 of ${m.total}`;
}
async function select(id) {
  cur = id; renderSubs();
  const s = subs.find(x => x.id === id); if (!s) return;
  header(s.name, s.url, true);
  if (running.has(id)) paintProg(prog[id] || { downloaded: 0, skipped: 0 }); else if (!previewing) hideProg();
  await refreshGallery(true);
}
setInterval(() => { if (cur && running.has(cur)) refreshGallery(false); }, 3000);

// ---- preview ----
$('prev').onclick = async () => {
  const url = $('url').value.trim(); if (!url || previewing) return;
  cur = null; renderSubs(); previewing = true; pvCount = 0;
  header('Previewing…', url, false); thumbs([], 'preview'); $('empty').hidden = true;
  showProg('Looking up profile… this can take a minute on Instagram or X', null);
  const r = await api.preview({ url });
  previewing = false; hideProg(); $('stop').hidden = !running.size;
  if (r.cancelled) return header('Preview cancelled', '', false);
  if (!r.ok) {
    header('Preview failed', '', false); $('empty').textContent = r.error; $('empty').hidden = pvCount > 0;
    return line('Preview: ' + r.error, 'err');
  }
  header(r.profile || 'Preview', `Preview: ${r.count} item(s). Press Add to subscribe.`, false);
};
api.onPreviewItem(it => {
  if (!previewing) return;
  addThumb(it, 'preview'); pvCount++; $('empty').hidden = true;
  showProg(`Looking up profile… found ${pvCount} item(s)`, null);
});
$('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('prev').click(); });

// ---- actions ----
$('add').onclick = async () => {
  const url = $('url').value.trim(); if (!url) return;
  const r = await api.addSub({ url });
  if (!r.ok) return line(r.error, 'err');
  $('url').value = ''; subs = (await api.state()).subs; select(r.sub.id);
};
$('check').onclick = () => api.sync(cur);
$('folder').onclick = () => api.openFolder(cur);
$('stop').onclick = () => api.cancel();
$('remove').onclick = async () => {
  if (!confirm('Remove this subscription? Downloaded files stay on disk.')) return;
  await api.removeSub(cur); cur = null; header('Welcome', '', false); thumbs([], 'x'); hideProg(); $('empty').textContent = 'Subscription removed.';
};

// ---- login / settings ----
async function showWho() {
  const ok = (await api.logins()).filter(x => x.ok).map(x => x.name);
  $('who').textContent = ok.length ? '✓ Signed in: ' + ok.join(', ') : 'Not signed in anywhere yet.';
  $('chips').textContent = ok.length ? '✓ ' + ok.join(' · ') : 'Not signed in';
  document.querySelectorAll('.sites button').forEach(b => { b.textContent = b.dataset.l + (ok.includes(b.dataset.n) ? ' ✓' : ''); });
}
$('login').onclick = () => { $('dLogin').showModal(); showWho(); };
$('loginClose').onclick = () => $('dLogin').close();
document.querySelectorAll('.sites button').forEach(b => b.onclick = async () => {
  const r = await api.login({ url: b.dataset.u, site: b.dataset.n });
  if (r.ok && r.already) line(`Already signed in to ${b.dataset.n}. Sign out in Settings to switch accounts.`, 'info');
});
$('otherGo').onclick = async () => { const r = await api.login({ url: $('otherU').value.trim(), site: null }); if (!r.ok) line(r.error, 'err'); };
$('set').onclick = async () => { const s = await api.state(); $('outDir').value = s.settings.outDir; $('interval').value = String(s.settings.interval); $('dSet').showModal(); };
$('setClose').onclick = () => $('dSet').close();
$('outBrowse').onclick = async () => { const p = await api.pickDir(); if (p) $('outDir').value = p; };
$('interval').onchange = e => api.setInterval(e.target.value);
$('logout').onclick = async () => { await api.logout(); line('Signed out of all sites.', 'ok'); };

// ---- events ----
api.onLog(m => line(m.text, m.type));
api.onSubs(s => { subs = s; renderSubs(); });
api.onProgress(p => { prog[p.id] = p; if (p.id === cur && running.has(p.id)) paintProg(p); soon(); });
api.onState(m => {
  m.running ? running.add(m.id) : running.delete(m.id);
  renderSubs(); $('stop').hidden = !(running.size || previewing);
  if (m.id !== cur) return;
  if (m.running) paintProg(prog[m.id] || { downloaded: 0, skipped: 0 });
  else {
    const p = prog[m.id] || {};
    showProg(`✓ Finished · ${p.gained || 0} new file(s)`, 100, true);
    clearTimeout(hideT); hideT = setTimeout(() => { if (!running.has(cur)) hideProg(); }, 7000);
    refreshGallery(true);
  }
});
api.onLogin(m => {
  showWho();
  if (!m.site) return line('Session updated.', 'info');
  const s = m.status.find(x => x.name === m.site);
  if (s && s.ok) { line(`✓ Signed in to ${m.site}.`, 'ok'); $('dLogin').close(); }
  else line(`Login window closed, but ${m.site} does not look signed in yet.`, 'err');
});

// ---- auto update ----
api.onUpdate(m => {
  const box = $('upd'), t = $('updText'), b = $('updBtn');
  box.hidden = false; b.hidden = false;
  if (m.state === 'downloading') { t.textContent = `Hoardr ${m.version} is downloading in the background…`; b.hidden = true; }
  else if (m.state === 'ready') { t.textContent = `Hoardr ${m.version} is ready.`; b.textContent = 'Restart & update'; b.onclick = () => api.installUpdate(); }
  else if (m.state === 'manual') { t.textContent = `Hoardr ${m.version} is available.`; b.textContent = 'Download'; b.onclick = () => api.openRelease(); }
  else box.hidden = true;
  if (m.state === 'none') $('chkMsg').textContent = 'You are up to date.';
  if (m.state === 'error') $('chkMsg').textContent = 'Update check failed.';
});
$('chk').onclick = async () => { $('chkMsg').textContent = (await api.checkUpdate()) ? 'Checking…' : 'Updates work in the installed app only.'; };

(async () => { const s = await api.state(); subs = s.subs; $('ver').textContent = 'v' + s.version; renderSubs(); header('Welcome', '', false); showWho(); })();
