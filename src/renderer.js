const $ = id => document.getElementById(id);
let subs = [], cur = null, lastTotal = -1, hideT, rT;
let running = new Set(), prog = {}, previewing = false, pvCount = 0, queued = new Set();
let view = localStorage.getItem('hv') || 'grid', filt = localStorage.getItem('hf') || 'all', gItems = [], gTotal = 0;
const WELCOME = $('empty').textContent;
const syncStop = () => { $('stop').hidden = !(running.size || previewing || queued.size); };
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';

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
    d.innerHTML = '<div class="sl"><span class="av"></span><div><b></b><i></i></div></div><span class="dot"></span>';
    const av = d.querySelector('.av');
    if (s.avUrl) { const im = document.createElement('img'); im.className = 'av'; im.src = s.avUrl; im.onerror = () => im.replaceWith(av); av.textContent = (s.name || '?')[0].toUpperCase(); av.replaceWith(im); d.querySelector('.sl').prepend(im); }
    else av.textContent = (s.name || '?')[0].toUpperCase();
    d.querySelector('b').textContent = s.title || s.name;
    const p = prog[s.id];
    d.querySelector('i').textContent = running.has(s.id) ? `Syncing… ${p ? p.downloaded : 0} new` : queued.has(s.id) ? 'Queued, waiting…' : `${s.host} · ${s.count} files · ${ago(s.last)}${s.types === 'photos' ? ' · photos' : s.types === 'videos' ? ' · videos' : ''}`;
    d.querySelector('.dot').classList.toggle('run', running.has(s.id) || queued.has(s.id));
    d.onclick = () => select(s.id);
    box.appendChild(d);
  }
}
const soon = () => { if (!rT) rT = setTimeout(() => { rT = null; renderSubs(); }, 500); };

// ---- grid ----
function addThumb(it, kind) {
  const d = document.createElement('div'); d.className = 'th'; d.title = it.label;
  if (it.src && it.video && !it.thumbOnly && (kind === 'file' || kind === 'preview')) {
    const v = document.createElement('video'); v.src = it.src + '#t=0.1'; v.muted = true; v.preload = 'metadata'; if (kind === 'preview') v.referrerPolicy = 'no-referrer'; v.onerror = () => { v.remove(); d.append('🎬'); }; d.appendChild(v);
  } else if (it.src) {
    const img = document.createElement('img'); img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = it.src;
    img.onerror = () => { img.remove(); d.append(it.video ? '🎬' : '🖼️'); }; d.appendChild(img);
  } else d.textContent = it.video ? '🎬' : '🖼️';
  if (it.video) { const b = document.createElement('span'); b.className = 'b'; b.textContent = '▶'; d.appendChild(b); }
  if (kind === 'file') d.onclick = () => api.openPath(it.path);
  $('grid').appendChild(d);
}
function thumbs(items, kind) {
  $('grid').className = ''; $('grid').textContent = ''; $('empty').hidden = items.length > 0;
  items.forEach(it => addThumb(it, kind));
}
function card(c) {
  if (!c || (!c.title && !c.image && !c.desc && !c.handle)) { $('pcard').hidden = true; return; }
  $('pcard').hidden = false;
  const im = $('pav'); im.hidden = !c.image; im.onerror = () => { im.hidden = true; };
  if (c.image) { im.referrerPolicy = 'no-referrer'; im.src = c.image; }
  $('pname').textContent = c.title || c.handle || ''; $('phandle').textContent = c.title ? (c.handle || '') : '';
  $('pbio').textContent = c.desc || '';
}
const subCard = s => card({ image: s.avUrl, title: s.title || s.name, handle: '@' + s.name, desc: s.bio });
function header(title, sub, own) {
  $('title').textContent = title; $('sub').textContent = sub || '';
  for (const id of ['check', 'folder', 'remove', 'closeG', 'types', 'gtools']) $(id).hidden = !own;
  syncStop();
}

function addRow(it) {
  const d = document.createElement('div'); d.className = 'r2'; d.title = it.label;
  const t = document.createElement('div'); t.className = 'rt';
  if (it.video) { const v = document.createElement('video'); v.src = it.src + '#t=0.1'; v.muted = true; v.preload = 'metadata'; v.onerror = () => { v.remove(); t.append('🎬'); }; t.appendChild(v); }
  else { const im = document.createElement('img'); im.loading = 'lazy'; im.src = it.src; im.onerror = () => { im.remove(); t.append('🖼️'); }; t.appendChild(im); }
  const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = it.label;
  const tag = document.createElement('div'); tag.className = 'tag' + (it.video ? ' v' : ''); tag.textContent = it.video ? 'Video' : 'Photo';
  const sz = document.createElement('div'); sz.className = 'mt'; sz.textContent = fmtSize(it.size || 0);
  const dt = document.createElement('div'); dt.className = 'mt'; dt.textContent = new Date(it.t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const fb = document.createElement('button'); fb.className = 'ghost'; fb.textContent = '📂'; fb.title = 'Show in folder';
  fb.onclick = e => { e.stopPropagation(); api.showFile(it.path); };
  d.append(t, nm, tag, sz, dt, fb); d.onclick = () => api.openPath(it.path);
  $('grid').appendChild(d);
}
function paintToggles() {
  document.querySelectorAll('#fseg button').forEach(b => b.classList.toggle('on', b.dataset.f === filt));
  document.querySelectorAll('#vseg button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
}
function renderGallery() {
  const items = gItems.filter(i => filt === 'all' || (filt === 'videos') === !!i.video);
  const g = $('grid'); g.textContent = ''; g.className = view === 'list' ? 'list' : '';
  items.forEach(i => view === 'list' ? addRow(i) : addThumb(i, 'file'));
  $('empty').hidden = items.length > 0;
  $('empty').textContent = running.has(cur) ? 'Downloading… files appear here as they arrive.' : filt !== 'all' && gItems.length ? `No ${filt} in this profile yet.` : 'No files yet. They will appear here once downloaded.';
  $('gcount').textContent = `${items.length} shown` + (gTotal > gItems.length ? ` · newest ${gItems.length} of ${gTotal}` : '');
  paintToggles();
}
async function refreshGallery(force) {
  if (!cur) return;
  const m = await api.media(cur);
  if (!force && m.total === lastTotal) return;
  lastTotal = m.total; gItems = m.items; gTotal = m.total; renderGallery();
}
document.querySelectorAll('#fseg button').forEach(b => b.onclick = () => { filt = b.dataset.f; localStorage.setItem('hf', filt); renderGallery(); });
document.querySelectorAll('#vseg button').forEach(b => b.onclick = () => { view = b.dataset.v; localStorage.setItem('hv', view); renderGallery(); });
async function select(id) {
  cur = id; renderSubs();
  const s = subs.find(x => x.id === id); if (!s) return;
  header(s.title || s.name, s.url, true); subCard(s); $('types').value = s.types || 'both';
  if (running.has(id)) paintProg(prog[id] || { downloaded: 0, skipped: 0 }); else if (queued.has(id)) showProg('Queued, waiting for a free slot…', null); else if (!previewing) hideProg();
  await refreshGallery(true);
}
setInterval(() => { if (cur && running.has(cur)) refreshGallery(false); }, 3000);

// ---- target: site dropdown + username or link ----
const SITE_URLS = {
  instagram: u => `https://www.instagram.com/${u}/`, x: u => `https://x.com/${u}/media`, facebook: u => `https://www.facebook.com/${u}/photos`,
  threads: u => `https://www.threads.net/@${u}`, tiktok: u => `https://www.tiktok.com/@${u}`, reddit: u => `https://www.reddit.com/user/${u}/`,
  pinterest: u => `https://www.pinterest.com/${u}/`, youtube: u => `https://www.youtube.com/@${u}/videos`
};
const HOST_SITE = { 'instagram.com': 'instagram', 'x.com': 'x', 'twitter.com': 'x', 'facebook.com': 'facebook', 'threads.net': 'threads', 'threads.com': 'threads', 'tiktok.com': 'tiktok', 'reddit.com': 'reddit', 'pinterest.com': 'pinterest', 'youtube.com': 'youtube' };
function target() {
  let raw = $('url').value.trim(); if (!raw) return null;
  if (/^[\w-]+(\.[\w-]+)+\//.test(raw) && !/^https?:/i.test(raw)) raw = 'https://' + raw;
  if (/^https?:\/\//i.test(raw)) return { url: raw, name: null };
  const site = $('site').value;
  if (site === 'other') return { error: 'For other sites, paste the full profile link.' };
  const u = raw.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[\w.\-]+$/.test(u)) return { error: 'Enter just a username (letters, numbers, . _ -) or a full profile link.' };
  return { url: SITE_URLS[site](u), name: u };
}
$('url').addEventListener('input', () => {   // pasting a link picks the right site automatically
  const v = $('url').value.trim(); if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+\//i.test(v)) return;
  try { const h = new URL(/^https?:/i.test(v) ? v : 'https://' + v).hostname.replace(/^www\./, '').replace(/^(m|mobile)\./, '');
    $('site').value = HOST_SITE[h] || 'other'; } catch {}
});

// ---- preview ----
$('prev').onclick = async () => {
  const t = target(); if (!t || previewing) return;
  if (t.error) return line(t.error, 'err');
  cur = null; renderSubs(); previewing = true; pvCount = 0; card(null);
  header('Previewing…', t.url, false); thumbs([], 'preview'); $('empty').hidden = true;
  showProg('Looking up profile… this can take a minute on Instagram or X', null);
  const r = await api.preview({ url: t.url });
  previewing = false; hideProg(); syncStop();
  if (r.cancelled) return header('Preview cancelled', '', false);
  if (!r.ok) {
    header('Preview failed', '', false); $('empty').textContent = r.error; $('empty').hidden = pvCount > 0;
    return line('Preview: ' + r.error, 'err');
  }
  header(r.profile || 'Preview', r.warn ? `Only ${r.count} item(s) found. ⚠ ${r.warn}` : `Preview: ${r.count} item(s). Press Add to subscribe.`, false);
  if (r.warn) line('Preview warning: ' + r.warn, 'err');
};
api.onPreviewItem(it => {
  if (!previewing) return;
  addThumb(it, 'preview'); pvCount++; $('empty').hidden = true;
  showProg(`Looking up profile… found ${pvCount} item(s)`, null);
});
api.onPreviewProfile(c => { if (previewing || !cur) card(c); });
$('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('prev').click(); });

// ---- actions ----
$('add').onclick = async () => {
  const t = target(); if (!t) return;
  if (t.error) return line(t.error, 'err');
  const r = await api.addSub({ url: t.url, name: t.name, types: $('dtype').value });
  if (!r.ok) return line(r.error, 'err');
  $('url').value = ''; subs = (await api.state()).subs; select(r.sub.id);
};
$('check').onclick = () => api.sync(cur);
$('folder').onclick = () => api.openFolder(cur);
$('stop').onclick = () => previewing ? api.cancelPreview() : api.cancel(cur ? { id: cur } : {});
$('types').onchange = e => api.setTypes({ id: cur, types: e.target.value });
$('closeG').onclick = () => {
  cur = null; lastTotal = -1; gItems = []; renderSubs(); header('Welcome', '', false); thumbs([], 'x'); card(null);
  $('empty').textContent = WELCOME; $('empty').hidden = false; if (!previewing) hideProg();
};
$('remove').onclick = async () => {
  if (!confirm('Remove this subscription? Downloaded files stay on disk.')) return;
  await api.removeSub(cur); cur = null; header('Welcome', '', false); thumbs([], 'x'); hideProg(); card(null); $('empty').textContent = 'Subscription removed.';
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
async function doLogin(b, force) {
  if (b.dataset.n === 'X' && !force) {   // X rate-limits and blocks sign-in inside apps, so steer to the cookie method first
    $('dLogin').querySelector('details.alt').open = true;
    if (confirm('X often blocks or rate-limits sign-in inside apps ("We have temporarily limited your login").\n\nOK: use the cookie method below (recommended, works with the session already open in your browser).\nCancel: try signing in inside Hoardr anyway.')) return;
  }
  const r = await api.login({ url: b.dataset.u, site: b.dataset.n, force });
  if (!r.ok) return line(r.error, 'err');
  if (r.already && confirm(`You are already signed in to ${b.dataset.l}.\nSign in again? This replaces the current session.`)) doLogin(b, true);
}
document.querySelectorAll('.sites button').forEach(b => b.onclick = () => doLogin(b, false));
$('xSave').onclick = async () => {
  const r = await api.setXCookies({ authToken: $('xAuth').value, ct0: $('xCt0').value });
  if (!r.ok) return line(r.error, 'err'); $('xAuth').value = ''; $('xCt0').value = '';
};
$('impCk').onclick = async () => {
  const r = await api.importCookies(); if (r.cancelled) return;
  line(r.ok ? `Imported ${r.count} cookies.` : 'No usable cookies found in that file.', r.ok ? 'ok' : 'err');
};
$('otherGo').onclick = async () => { const r = await api.login({ url: $('otherU').value.trim(), site: null }); if (!r.ok) line(r.error, 'err'); };
$('set').onclick = async () => { const s = await api.state(); $('outDir').value = s.settings.outDir; $('interval').value = String(s.settings.interval); $('dSet').showModal(); };
$('setClose').onclick = () => $('dSet').close();
$('outBrowse').onclick = async () => { const p = await api.pickDir(); if (p) $('outDir').value = p; };
$('interval').onchange = e => api.setInterval(e.target.value);
$('logout').onclick = async () => { await api.logout(); line('Signed out of all sites.', 'ok'); };

// ---- events ----
api.onLog(m => line(m.text, m.type));
api.onSubs(s => { subs = s; renderSubs(); const c = subs.find(x => x.id === cur); if (c) { subCard(c); $('types').value = c.types || 'both'; } });
api.onQueue(q => { queued = new Set(q); renderSubs(); syncStop(); if (cur && queued.has(cur) && !running.has(cur)) showProg('Queued, waiting for a free slot…', null); });
api.onProgress(p => { prog[p.id] = p; if (p.id === cur && running.has(p.id)) paintProg(p); soon(); });
api.onState(m => {
  m.running ? running.add(m.id) : running.delete(m.id);
  renderSubs(); syncStop();
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
