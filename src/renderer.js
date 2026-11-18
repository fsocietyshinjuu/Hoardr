const $ = id => document.getElementById(id);
let subs = [], cur = null, running = new Set();

function line(text, cls = '') {
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  const l = $('log'); l.appendChild(d); l.scrollTop = l.scrollHeight;
  while (l.childNodes.length > 1500) l.removeChild(l.firstChild);
}
const ago = t => { if (!t) return 'never checked'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

function renderSubs() {
  const box = $('subs'); box.textContent = '';
  for (const s of subs) {
    const d = document.createElement('div'); d.className = 's' + (s.id === cur ? ' on' : '');
    d.innerHTML = '<div><b></b><i></i></div><span class="dot"></span>';
    d.querySelector('b').textContent = s.name;
    d.querySelector('i').textContent = `${s.host} · ${s.count} files · ${ago(s.last)}`;
    d.querySelector('.dot').classList.toggle('run', running.has(s.id));
    d.onclick = () => select(s.id);
    box.appendChild(d);
  }
}

function thumbs(items, kind) {
  const g = $('grid'); g.textContent = ''; $('empty').hidden = items.length > 0;
  for (const it of items) {
    const d = document.createElement('div'); d.className = 'th'; d.title = it.label;
    if (it.src && kind === 'file' && it.video) {
      const v = document.createElement('video'); v.src = it.src + '#t=0.1'; v.muted = true; v.preload = 'metadata'; d.appendChild(v);
    } else if (it.src) {
      const img = document.createElement('img'); img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = it.src;
      img.onerror = () => { img.remove(); d.append(it.video ? '🎬' : '🖼️'); }; d.appendChild(img);
    } else d.textContent = it.video ? '🎬' : '🖼️';
    if (it.video) { const b = document.createElement('span'); b.className = 'b'; b.textContent = '▶'; d.appendChild(b); }
    if (kind === 'file') d.onclick = () => api.openPath(it.path);
    g.appendChild(d);
  }
}
function header(title, sub, own) {
  $('title').textContent = title; $('sub').textContent = sub || '';
  for (const id of ['check', 'folder', 'remove']) $(id).hidden = !own;
  $('stop').hidden = !running.size;
}

async function select(id) {
  cur = id; renderSubs();
  const s = subs.find(x => x.id === id); if (!s) return;
  header(s.name, `${s.url}`, true);
  const m = await api.media(id);
  thumbs(m.items, 'file');
  $('empty').textContent = running.has(id) ? 'Downloading… files appear here when done.' : 'No files yet. Press Check now.';
  if (m.total > 300) $('sub').textContent = `showing newest 300 of ${m.total}`;
}

$('prev').onclick = async () => {
  const url = $('url').value.trim(); if (!url) return;
  cur = null; renderSubs(); header('Loading preview…', url, false); thumbs([], 'x'); $('empty').textContent = 'Loading…';
  const r = await api.preview({ url });
  if (!r.ok) { header('Preview failed', '', false); $('empty').textContent = r.error; $('empty').hidden = false; return line('Preview: ' + r.error, 'err'); }
  header(r.profile || 'Preview', `Preview of first ${r.items.length} items. Press Add to subscribe.`, false);
  thumbs(r.items, 'preview');
};
$('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('prev').click(); });
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
  await api.removeSub(cur); cur = null; header('Welcome', '', false); thumbs([], 'x'); $('empty').textContent = 'Subscription removed.';
};

// dialogs
async function showWho() { const l = await api.logins(); $('who').textContent = l.length ? 'Signed in: ' + l.join(', ') : 'Not signed in anywhere yet.'; }
$('login').onclick = () => { $('dLogin').showModal(); showWho(); };
$('loginClose').onclick = () => $('dLogin').close();
document.querySelectorAll('.sites button').forEach(b => b.onclick = () => api.login(b.dataset.u));
$('otherGo').onclick = async () => { const r = await api.login($('otherU').value.trim()); if (!r.ok) line(r.error, 'err'); };
$('set').onclick = async () => { const s = await api.state(); $('outDir').value = s.settings.outDir; $('interval').value = String(s.settings.interval); $('dSet').showModal(); };
$('setClose').onclick = () => $('dSet').close();
$('outBrowse').onclick = async () => { const p = await api.pickDir(); if (p) $('outDir').value = p; };
$('interval').onchange = e => api.setInterval(e.target.value);
$('logout').onclick = async () => { await api.logout(); line('Signed out of all sites.', 'ok'); };

// events
api.onLog(m => line(m.text, m.type));
api.onSubs(s => { subs = s; renderSubs(); if (cur) select(cur); });
api.onState(m => { m.running ? running.add(m.id) : running.delete(m.id); renderSubs(); $('stop').hidden = !running.size; if (!m.running && m.id === cur) select(cur); });
api.onLogin(() => { showWho(); line('Login saved.', 'ok'); });

(async () => { const s = await api.state(); subs = s.subs; $('ver').textContent = 'v' + s.version; renderSubs(); header('Welcome', '', false); })();

// ---- auto update ----
let updState = null;
api.onUpdate(m => {
  updState = m.state;
  const box = $('upd'), t = $('updText'), b = $('updBtn');
  box.className = ''; box.hidden = false; b.hidden = false;
  if (m.state === 'downloading') { t.textContent = `Hoardr ${m.version} is downloading in the background…`; b.hidden = true; }
  else if (m.state === 'ready') { t.textContent = `Hoardr ${m.version} is ready.`; b.textContent = 'Restart & update'; b.onclick = () => api.installUpdate(); }
  else if (m.state === 'manual') { t.textContent = `Hoardr ${m.version} is available.`; b.textContent = 'Download'; b.onclick = () => api.openRelease(); }
  else { box.hidden = true; }
  if (m.state === 'none') $('chkMsg').textContent = 'You are up to date.';
  if (m.state === 'error') { $('chkMsg').textContent = 'Update check failed.'; }
});
$('chk').onclick = async () => { $('chkMsg').textContent = (await api.checkUpdate()) ? 'Checking…' : 'Updates work in the installed app only.'; };
