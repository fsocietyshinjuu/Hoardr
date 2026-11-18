const $ = id => document.getElementById(id);
const logEl = $('log');
let busy = false;
function line(text, cls = '') {
  const d = document.createElement('div'); d.className = cls; d.textContent = text;
  logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
  while (logEl.childNodes.length > 2000) logEl.removeChild(logEl.firstChild);
}
function setBusy(b) { busy = b; $('go').disabled = b; $('prev').disabled = b; $('stop').disabled = !b; $('status').textContent = b ? 'Downloading…' : ''; }
api.version().then(v => $('ver').textContent = 'v' + v);
$('pickOut').onclick = async () => { const p = await api.pickDir(); if (p) $('out').value = p; };
$('pickCk').onclick = async () => { const p = await api.pickCookies(); if (p) $('cookies').value = p; };
$('open').onclick = () => $('out').value && api.openDir($('out').value);
$('stop').onclick = () => { api.cancel(); line('Cancelled.', 'err'); setBusy(false); };
$('go').onclick = async () => {
  const r = await api.start({ url: $('url').value.trim(), outDir: $('out').value, cookies: $('cookies').value || null, mode: $('mode').value, rateLimit: $('rate').value.trim() || null });
  if (!r.ok) return line(r.error, 'err');
  setBusy(true);
};
api.onLog(m => line(m.text, m.type));
api.onDone(m => { setBusy(false); line(m.code === 0 ? 'Finished.' : `Stopped (exit code ${m.code}).`, m.code === 0 ? 'ok' : 'err'); });

// ---- Profile preview ----
function showPreview(r) {
  const grid = $('grid'); grid.textContent = '';
  $('pvname').textContent = r.profile || 'Preview';
  $('pvcount').textContent = `Showing first ${r.items.length} item${r.items.length === 1 ? '' : 's'}`;
  for (const it of r.items) {
    const d = document.createElement('div'); d.className = 'th'; d.title = it.label;
    if (it.thumb) {
      const img = document.createElement('img');
      img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; img.src = it.thumb;
      img.onerror = () => { img.remove(); d.append(it.video ? '🎬' : '🖼️'); };
      d.appendChild(img);
    } else d.textContent = it.video ? '🎬' : '🖼️';
    if (it.video) { const b = document.createElement('span'); b.className = 'b'; b.textContent = '▶'; d.appendChild(b); }
    grid.appendChild(d);
  }
  $('pv').hidden = false;
}
$('prev').onclick = async () => {
  const url = $('url').value.trim();
  if (!url) return line('Enter a URL to preview.', 'err');
  $('prev').disabled = true;
  $('status').innerHTML = '<span class="spin"></span>Loading preview…';
  const r = await api.preview({ url, cookies: $('cookies').value || null, mode: $('mode').value });
  $('prev').disabled = busy; $('status').textContent = '';
  if (!r.ok) { $('pv').hidden = true; return line('Preview: ' + r.error, 'err'); }
  showPreview(r);
};
$('pvclose').onclick = () => { api.cancelPreview(); $('pv').hidden = true; };
$('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('prev').click(); });
