const { app, BrowserWindow, ipcMain, dialog, shell, session, net, Tray, Menu, Notification, nativeImage } = require('electron');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

// Paid / subscriber-only platforms are intentionally unsupported.
const BLOCKED = ['onlyfans.com', 'fantia.jp'];
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'dailymotion.com'];
const IMG = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];
const VID = ['mp4', 'webm', 'mov', 'mkv', 'm4v'];
const PART = 'persist:hoardr'; // the in-app login session
const PREVIEW_COUNT = 24;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

let win, child, pchild, timer, running = false;
let tray = null, trayOk = false, quitting = false;
let queue = [], subs = [], settings = {};

// ---------- storage ----------
const jp = f => path.join(app.getPath('userData'), f);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(jp(f), 'utf8')); } catch { return d; } };
const writeJ = (f, v) => fs.writeFileSync(jp(f), JSON.stringify(v, null, 2));
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const pub = () => subs.map(s => ({ ...s, avUrl: s.avatar && fs.existsSync(s.avatar) ? pathToFileURL(s.avatar).href + '?v=' + (s.avT || 0) : null }));
const saveSubs = () => { writeJ('subs.json', subs); send('subs', pub()); };
const log = (id, type, text) => send('log', { id, type, text });

// ---------- helpers ----------
function binPath(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const dirs = [path.join(process.resourcesPath || '', 'bin'), path.join(__dirname, '..', 'bin')];
  for (const d of dirs) { const p = path.join(d, exe); if (fs.existsSync(p)) return p; }
  return name;
}
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const matches = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
const clean = s => String(s).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'profile';
const lastErr = s => s.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');

function plan(url) {
  const host = hostOf(url);
  if (!host) return { error: 'That does not look like a valid URL.' };
  if (matches(host, BLOCKED)) return { error: 'This platform serves paid, subscriber-only content and is not supported by Hoardr.' };
  const ytdlp = matches(host, VIDEO_HOSTS);
  return { host, ytdlp, cmd: binPath(ytdlp ? 'yt-dlp' : 'gallery-dl') };
}

function media(folder) {
  const out = [];
  (function walk(d, depth) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 2) walk(p, depth + 1); continue; }
      const ext = path.extname(e.name).slice(1).toLowerCase();
      if (IMG.includes(ext) || VID.includes(ext)) out.push({ p, t: fs.statSync(p).mtimeMs, v: VID.includes(ext) });
    }
  })(folder, 0);
  return out.sort((a, b) => b.t - a.t);
}

// Export the in-app login session as a Netscape cookies file for the engines
async function exportCookies() {
  const cs = await session.fromPartition(PART).cookies.get({});
  const far = Math.floor(Date.now() / 1000) + 31536000;
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cs) {
    const d = c.domain || '';
    lines.push([(c.httpOnly ? '#HttpOnly_' : '') + d, d.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/',
      c.secure ? 'TRUE' : 'FALSE', c.expirationDate ? Math.floor(c.expirationDate) : far, c.name, c.value].join('\t'));
  }
  fs.writeFileSync(jp('cookies.txt'), lines.join('\n') + '\n');
  return jp('cookies.txt');
}

// ---------- window ----------
function showWin() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function createWindow() {
  win = new BrowserWindow({
    icon: ICON, width: 1180, height: 780, minWidth: 900, minHeight: 600, show: false, backgroundColor: '#0f1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('close', e => {
    if (quitting || !trayOk) return;
    e.preventDefault(); win.hide();
    if (Notification.isSupported())
      new Notification({ title: 'Hoardr is still running', body: 'It keeps syncing in the system tray. Click the tray icon to reopen, or right-click it to quit.', icon: ICON }).show();
  });
  win.loadFile(path.join(__dirname, 'index.html'));
}
function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 }));
    tray.setToolTip('Hoardr');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Hoardr', click: showWin },
      { label: 'Check all profiles now', click: () => enqueue('all') },
      { type: 'separator' },
      { label: 'Quit Hoardr', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showWin);
    trayOk = true;
  } catch { trayOk = false; }
}

// ---------- state / settings ----------
ipcMain.handle('state', () => ({ subs: pub(), settings, version: app.getVersion() }));
ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  settings.outDir = r.filePaths[0]; writeJ('settings.json', settings); return settings.outDir;
});
ipcMain.handle('set-interval', (_e, m) => { settings.interval = Number(m) || 0; writeJ('settings.json', settings); schedule(); return true; });
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('open-folder', (_e, id) => { const s = subs.find(x => x.id === id); if (s) { fs.mkdirSync(s.folder, { recursive: true }); shell.openPath(s.folder); } });

// ---------- login ----------
const SITES = [
  { name: 'Instagram', hosts: ['instagram.com'], cookies: ['sessionid'] },
  { name: 'X', hosts: ['x.com', 'twitter.com'], cookies: ['auth_token'] },
  { name: 'Facebook', hosts: ['facebook.com'], cookies: ['c_user', 'xs'] },
  { name: 'Threads', hosts: ['threads.net', 'threads.com'], cookies: ['sessionid'] },
  { name: 'TikTok', hosts: ['tiktok.com'], cookies: ['sessionid'] },
  { name: 'Reddit', hosts: ['reddit.com'], cookies: ['reddit_session'] },
  { name: 'Pinterest', hosts: ['pinterest.com'], cookies: ['_auth'] },
  { name: 'YouTube', hosts: ['youtube.com', 'google.com'], cookies: ['SAPISID'] }
];
const ses = () => session.fromPartition(PART);
const dom = c => c.domain.replace(/^\./, '');
const inHosts = (c, hosts) => hosts.some(h => dom(c) === h || dom(c).endsWith('.' + h));

async function loginStatus() {
  const cs = await ses().cookies.get({});
  return SITES.map(s => ({ name: s.name, ok: s.cookies.every(n => cs.some(c => c.name === n && c.value && c.value !== '0' && inHosts(c, s.hosts))) }));
}
const ckUrl = c => `http${c.secure ? 's' : ''}://${dom(c)}${c.path || '/'}`;
async function persistCookies() {
  const cs = await ses().cookies.get({});
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;
  for (const c of cs) {
    if (c.expirationDate || c.name.startsWith('__Host-')) continue;
    try { await ses().cookies.set({ url: ckUrl(c), name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, expirationDate: exp }); } catch {}
  }
  try { await ses().cookies.flushStore(); } catch {}
}
async function clearSite(def) {
  for (const c of await ses().cookies.get({})) if (inHosts(c, def.hosts)) { try { await ses().cookies.remove(ckUrl(c), c.name); } catch {} }
}
async function refreshSession(site) {
  await persistCookies(); await exportCookies();
  send('login-done', { status: await loginStatus(), site });
}

ipcMain.handle('login', async (_e, { url, site, force }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  const def = SITES.find(x => x.name === site) || SITES.find(x => matches(p.host, x.hosts));
  if (def) {
    const was = (await loginStatus()).find(x => x.name === def.name).ok;
    if (was && !force) return { ok: true, already: true };
    if (force) await clearSite(def);
  }
  const lw = new BrowserWindow({
    icon: ICON, width: 540, height: 800, parent: win, title: `Log in${def ? ' to ' + def.name : ''}`,
    webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  lw.setMenuBarVisibility(false);
  lw.on('page-title-updated', e => e.preventDefault());
  lw.webContents.setUserAgent(lw.webContents.userAgent.replace(/\s?(Electron|hoardr)\/\S+/gi, ''));
  lw.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PART } } }));
  lw.loadURL(url);

  let done = false, busy = false, poll;
  const check = async () => {
    if (!def || done || busy || lw.isDestroyed()) return;
    busy = true;
    try {
      const st = (await loginStatus()).find(x => x.name === def.name);
      if (st && st.ok) {
        done = true; clearInterval(poll);
        if (!lw.isDestroyed()) lw.setTitle(`✓ Signed in to ${def.name}. Closing…`);
        await refreshSession(def.name);
        setTimeout(() => { if (!lw.isDestroyed()) lw.close(); }, 700);
      }
    } finally { busy = false; }
  };
  if (def) {
    poll = setInterval(check, 1000);
    lw.webContents.on('did-navigate', check); lw.webContents.on('did-navigate-in-page', check);
  }
  lw.on('closed', async () => { clearInterval(poll); if (!done) { done = true; await refreshSession(def ? def.name : null); } });
  return { ok: true };
});
ipcMain.handle('logins', loginStatus);
ipcMain.handle('logout', async () => {
  await ses().clearStorageData();
  try { fs.unlinkSync(jp('cookies.txt')); } catch {}
  send('login-done', { status: await loginStatus(), site: null });
  return true;
});

// Fallbacks when a site refuses to log in inside an app window
function parseNetscape(txt) {
  const out = [];
  for (let l of txt.split(/\r?\n/)) {
    let httpOnly = false;
    if (l.startsWith('#HttpOnly_')) { httpOnly = true; l = l.slice(10); } else if (!l.trim() || l.startsWith('#')) continue;
    const f = l.split('\t'); if (f.length < 7) continue;
    out.push({ domain: f[0], path: f[2], secure: f[3] === 'TRUE', exp: Number(f[4]) || 0, name: f[5], value: f.slice(6).join('\t'), httpOnly });
  }
  return out;
}
async function putCookie(c) {
  const exp = c.exp > Date.now() / 1000 ? c.exp : Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;
  try { await ses().cookies.set({ url: ckUrl(c), name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, expirationDate: exp }); return true; } catch { return false; }
}
ipcMain.handle('import-cookies', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cookies (Netscape)', extensions: ['txt'] }] });
  if (r.canceled) return { ok: false, cancelled: true };
  let n = 0;
  for (const c of parseNetscape(fs.readFileSync(r.filePaths[0], 'utf8'))) if (await putCookie(c)) n++;
  await refreshSession(null);
  return { ok: n > 0, count: n };
});
ipcMain.handle('set-x-cookies', async (_e, { authToken, ct0 }) => {
  const clean = v => String(v || '').trim().replace(/^["']|["']$/g, '');
  const a = clean(authToken), c = clean(ct0);
  if (!a || /\s/.test(a)) return { ok: false, error: 'Paste the auth_token value.' };
  for (const d of ['x.com', 'twitter.com']) {
    await putCookie({ domain: '.' + d, path: '/', secure: true, httpOnly: true, exp: 0, name: 'auth_token', value: a });
    if (c) await putCookie({ domain: '.' + d, path: '/', secure: true, httpOnly: false, exp: 0, name: 'ct0', value: c });
  }
  await refreshSession('X');
  return { ok: true };
});

// ---------- profile info (name, bio, picture) from the page's public preview tags ----------
const decodeHtml = t => String(t || '').replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d)).replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cleanTitle = t => (t || '').split(' • ')[0].replace(/\s*[\/|]\s*(X|Twitter|Facebook|TikTok|Reddit).*$/i, '').trim();
async function profileInfo(url) {
  const host = hostOf(url) || '';
  const uas = matches(host, ['x.com', 'twitter.com'])
    ? ['Twitterbot/1.0', 'facebookexternalhit/1.1'] : ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'Twitterbot/1.0'];
  for (const ua of uas) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
      const r = await net.fetch(url, { headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.8' }, signal: ac.signal });
      const html = (await r.text()).slice(0, 500000); clearTimeout(t);
      const meta = k => {
        const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i')) ||
                  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'));
        return m ? decodeHtml(m[1]) : '';
      };
      const title = cleanTitle(meta('og:title') || meta('twitter:title'));
      const desc = meta('og:description') || meta('twitter:description') || meta('description');
      const image = meta('og:image') || meta('twitter:image');
      if (title || image) return { title, desc, image };
    } catch {}
  }
  return null;
}
async function enrich(s) {
  const info = await profileInfo(s.url); if (!info) return;
  s.title = info.title; s.bio = info.desc;
  if (info.image) {
    try {
      const r = await net.fetch(info.image);
      if (r.ok) { fs.mkdirSync(s.folder, { recursive: true }); const f = path.join(s.folder, '.avatar.jpg'); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); s.avatar = f; s.avT = Date.now(); }
    } catch {}
  }
  saveSubs();
}

// ---------- subscriptions ----------
ipcMain.handle('add-sub', (_e, { url, name }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  if (subs.some(s => s.url === url)) return { ok: false, error: 'Already subscribed.' };
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0] || p.host;
  const slug = clean(seg);
  const s = { id: Date.now().toString(36), url, name: name || seg.replace(/^@/, ''), host: p.host,
    folder: path.join(settings.outDir, p.host, slug), last: null, count: 0 };
  subs.push(s); saveSubs(); enqueue(s.id); enrich(s);
  return { ok: true, sub: { ...s } };
});
ipcMain.handle('remove-sub', (_e, id) => { subs = subs.filter(s => s.id !== id); queue = queue.filter(q => q !== id); saveSubs(); return true; });
ipcMain.handle('media', (_e, id) => {
  const s = subs.find(x => x.id === id); if (!s) return [];
  const all = media(s.folder);
  return { total: all.length, items: all.slice(0, 300).map(m => ({ src: pathToFileURL(m.p).href, video: m.v, path: m.p, label: path.basename(m.p) })) };
});

// ---------- sync queue ----------
function enqueue(id) { if (id === 'all') subs.forEach(s => enqueue(s.id)); else if (!queue.includes(id)) queue.push(id); pump(); }
ipcMain.handle('sync', (_e, id) => { enqueue(id); return true; });
ipcMain.handle('cancel', () => { queue = []; if (child) child.kill(); if (pchild) pchild.kill(); return true; });

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const s = subs.find(x => x.id === queue.shift());
    if (s) await syncOne(s);
  }
  running = false;
}

const splitter = cb => { let b = ''; return d => { b += d; const ls = b.split(/\r?\n/); b = ls.pop(); ls.filter(Boolean).forEach(cb); }; };

async function syncOne(s) {
  const p = plan(s.url);
  if (p.error) return log(s.id, 'err', p.error);
  fs.mkdirSync(s.folder, { recursive: true });
  const arch = path.join(settings.outDir, '.hoardr'); fs.mkdirSync(arch, { recursive: true });
  const ck = await exportCookies();
  const args = p.ytdlp
    ? ['-P', s.folder, '-o', '%(title).150B [%(id)s].%(ext)s', '--download-archive', path.join(arch, s.id + '.txt'), '--no-overwrites', '--newline', '--ignore-errors', '--cookies', ck, s.url]
    : ['-D', s.folder, '--download-archive', path.join(arch, s.id + '.sqlite3'), '--cookies', ck, s.url];

  const before = media(s.folder).length;
  const st = { id: s.id, downloaded: 0, skipped: 0, current: '', pct: null, queued: 0, gained: 0 };
  let lastEmit = 0;
  const emit = force => { const n = Date.now(); if (force || n - lastEmit > 150) { lastEmit = n; st.queued = queue.length; send('progress', st); } };
  const onLine = line => {
    let m;
    if (p.ytdlp) {
      if ((m = line.match(/\[download\]\s+([\d.]+)%/))) { st.pct = parseFloat(m[1]); if (st.pct >= 100) st.downloaded++; }
      else if ((m = line.match(/\[download\] Destination: (.+)/))) { st.current = path.basename(m[1]); st.pct = 0; }
      else if (/already (been )?(recorded|downloaded)/.test(line)) st.skipped++;
    } else if (line.startsWith('# ')) st.skipped++;
    else if (!line.startsWith('[')) { st.downloaded++; st.current = path.basename(line); }
    emit();
  };

  send('state', { id: s.id, running: true });
  log(s.id, 'info', `Checking ${s.name} (${path.basename(p.cmd)})`);
  emit(true);
  await new Promise(res => {
    try { child = spawn(p.cmd, args, { windowsHide: true }); } catch (e) { log(s.id, 'err', String(e)); return res(); }
    child.stdout.on('data', splitter(l => { log(s.id, 'out', l); onLine(l); }));
    child.stderr.on('data', splitter(l => log(s.id, 'err', l)));
    child.on('error', e => { log(s.id, 'err', `Could not launch ${path.basename(p.cmd)}: ${e.message}`); res(); });
    child.on('close', code => {
      child = null;
      if (code !== 0) log(s.id, 'err', `Finished with errors (code ${code}). If the site needs login, use 🔑 Log in to a site.`);
      res();
    });
  });
  const total = media(s.folder).length;
  st.gained = Math.max(0, total - before); st.pct = 100;
  log(s.id, 'ok', `Done: ${st.gained} new file(s), ${st.skipped} already saved.`);
  emit(true);
  s.last = Date.now(); s.count = total; saveSubs();
  send('state', { id: s.id, running: false });
}

function schedule() {
  clearInterval(timer);
  if (settings.interval > 0) timer = setInterval(() => enqueue('all'), settings.interval * 60000);
}

// ---------- preview (streams items as they are found) ----------
ipcMain.handle('preview', async (_e, { url }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  if (pchild) { pchild.kill(); pchild = null; }
  const ck = await exportCookies();
  let seg = ''; try { seg = new URL(url).pathname.split('/').filter(Boolean)[0] || ''; } catch {}
  const handle = '@' + seg.replace(/^@/, '');
  profileInfo(url).then(i => send('preview-profile', { title: (i && i.title) || '', desc: (i && i.desc) || '', image: (i && i.image) || '', handle })).catch(() => {});
  const args = p.ytdlp
    ? ['-J', '--flat-playlist', '--playlist-end', String(PREVIEW_COUNT), '--no-warnings', '--cookies', ck, url]
    : ['-g', '--range', `1-${PREVIEW_COUNT}`, '--cookies', ck, url];

  return new Promise(resolve => {
    let err = '', out = '', count = 0, idle, idled = false, profile = seg.replace(/^@/, '');
    let me; try { me = spawn(p.cmd, args, { windowsHide: true }); } catch (e) { return resolve({ ok: false, error: String(e) }); }
    pchild = me;
    const poke = () => { clearTimeout(idle); idle = setTimeout(() => { idled = true; me.kill(); }, 120000); };
    poke();
    const emit = it => { count++; send('preview-item', it); };
    const byUrl = splitter(l => {
      const u = l.trim().replace(/^\|\s*/, '').replace(/^ytdl:/, '');
      if (!/^https?:\/\//.test(u) || count >= PREVIEW_COUNT) return;
      let name = u.split('?')[0].split('/').pop() || 'file'; try { name = decodeURIComponent(name); } catch {}
      const ext = name.split('.').pop().toLowerCase(), img = IMG.includes(ext);
      emit({ src: u, label: name, video: !img });
    });
    me.stdout.on('data', d => { poke(); if (p.ytdlp) { if (out.length < 8e6) out += d; } else byUrl(d); });
    me.stderr.on('data', d => { poke(); err += d; });
    me.on('error', e => { clearTimeout(idle); resolve({ ok: false, error: `Could not launch ${path.basename(p.cmd)}: ${e.message}` }); });
    me.on('close', () => {
      clearTimeout(idle); if (pchild === me) pchild = null;
      if (p.ytdlp) {
        try {
          const o = JSON.parse(out); profile = o.uploader || o.channel || o.title || profile;
          for (const e of (o.entries || [o]).filter(Boolean))
            emit({ src: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : null), label: e.title || e.id, video: true, thumbOnly: true });
        } catch {}
      }
      if (me.killed && !idled) return resolve({ ok: false, cancelled: true });
      if (!count) return resolve({ ok: false, error: idled ? 'Preview timed out (no response for 2 minutes).' : (lastErr(err) || 'Nothing found. Log in with 🔑 first if the site requires it.') });
      resolve({ ok: true, count, profile, warn: lastErr(err) });
    });
  });
});

// ---------- auto update ----------
const RELEASES = 'https://github.com/fsocietyshinjuu/Hoardr/releases/latest';
let updater = null;
function setupUpdates() {
  if (!app.isPackaged) return;
  try { updater = require('electron-updater').autoUpdater; } catch { return; }
  // Platforms that cannot self-update (unsigned macOS, portable .exe, .deb) only get a notice.
  const manual = process.platform === 'darwin' || !!process.env.PORTABLE_EXECUTABLE_DIR ||
    (process.platform === 'linux' && !process.env.APPIMAGE);
  updater.autoDownload = !manual;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-available', i => send('update', { state: manual ? 'manual' : 'downloading', version: i.version }));
  updater.on('update-downloaded', i => send('update', { state: 'ready', version: i.version }));
  updater.on('update-not-available', () => send('update', { state: 'none' }));
  updater.on('error', e => send('update', { state: 'error', message: String(e && e.message || e).split('\n')[0] }));
  const check = () => updater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 6 * 3600 * 1000);
}
ipcMain.handle('check-update', () => { if (!updater) return false; updater.checkForUpdates().catch(() => {}); return true; });
ipcMain.handle('install-update', () => { quitting = true; if (updater) updater.quitAndInstall(); });
ipcMain.handle('open-release', () => shell.openExternal(RELEASES));

// ---------- boot ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWin);
  app.on('activate', showWin);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { if (!trayOk) app.quit(); });
  app.whenReady().then(() => {
    app.setAppUserModelId('com.fsocietyshinjuu.hoardr');
    subs = readJ('subs.json', []);
    settings = Object.assign({ outDir: path.join(app.getPath('pictures'), 'Hoardr'), interval: 0 }, readJ('settings.json', {}));
    // Make the login window look like a normal Chrome to sites that block embedded browsers
    ses().webRequest.onBeforeSendHeaders((d, cb) => {
      const h = d.requestHeaders;
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'sec-ch-ua') h[k] = String(h[k]).replace(/"Electron";v="[^"]*",?\s*/g, '').replace(/,\s*$/, '');
      cb({ requestHeaders: h });
    });
    createWindow(); createTray(); schedule(); setupUpdates();
  });
}
