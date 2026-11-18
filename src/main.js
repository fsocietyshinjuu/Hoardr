const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
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
let queue = [], subs = [], settings = {};

// ---------- storage ----------
const jp = f => path.join(app.getPath('userData'), f);
const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(jp(f), 'utf8')); } catch { return d; } };
const writeJ = (f, v) => fs.writeFileSync(jp(f), JSON.stringify(v, null, 2));
const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const saveSubs = () => { writeJ('subs.json', subs); send('subs', subs); };
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
function createWindow() {
  win = new BrowserWindow({
    icon: ICON, width: 1180, height: 780, minWidth: 900, minHeight: 600, backgroundColor: '#0f1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

// ---------- state / settings ----------
ipcMain.handle('state', () => ({ subs, settings, version: app.getVersion() }));
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

async function loginStatus() {
  const cs = await ses().cookies.get({});
  return SITES.map(s => ({
    name: s.name,
    ok: s.cookies.every(n => cs.some(c => c.name === n && c.value && c.value !== '0' &&
      s.hosts.some(h => dom(c) === h || dom(c).endsWith('.' + h))))
  }));
}
// Session cookies would vanish when the app closes, so give them an expiry and flush to disk
async function persistCookies() {
  const cs = await ses().cookies.get({});
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 90;
  for (const c of cs) {
    if (c.expirationDate || c.name.startsWith('__Host-')) continue;
    try {
      await ses().cookies.set({ url: `http${c.secure ? 's' : ''}://${dom(c)}${c.path || '/'}`, name: c.name, value: c.value,
        domain: c.domain, path: c.path || '/', secure: c.secure, httpOnly: c.httpOnly, expirationDate: exp });
    } catch {}
  }
  try { await ses().cookies.flushStore(); } catch {}
}

ipcMain.handle('login', async (_e, { url, site }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  const def = SITES.find(x => x.name === site) || SITES.find(x => matches(p.host, x.hosts));
  const before = def ? (await loginStatus()).find(x => x.name === def.name).ok : false;
  const lw = new BrowserWindow({
    icon: ICON, width: 540, height: 800, parent: win, title: `Log in${def ? ' to ' + def.name : ''}`,
    webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  lw.setMenuBarVisibility(false);
  lw.on('page-title-updated', e => e.preventDefault());
  lw.webContents.setUserAgent(lw.webContents.userAgent.replace(/\s?(Electron|hoardr)\/\S+/gi, ''));
  lw.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PART } } }));
  lw.loadURL(url);

  let done = false, poll;
  const finish = async () => {
    await persistCookies(); await exportCookies();
    send('login-done', { status: await loginStatus(), site: def && def.name });
  };
  // Auto-detect a successful login, save it and close the window
  if (def && !before) {
    poll = setInterval(async () => {
      if (done || lw.isDestroyed()) return;
      const st = (await loginStatus()).find(x => x.name === def.name);
      if (st && st.ok) {
        done = true; clearInterval(poll);
        lw.setTitle(`✓ Signed in to ${def.name}. Closing…`);
        await finish();
        setTimeout(() => { if (!lw.isDestroyed()) lw.close(); }, 1200);
      }
    }, 1500);
  }
  lw.on('closed', async () => { clearInterval(poll); if (!done) { done = true; await finish(); } });
  return { ok: true, already: before };
});
ipcMain.handle('logins', loginStatus);
ipcMain.handle('logout', async () => {
  await ses().clearStorageData();
  try { fs.unlinkSync(jp('cookies.txt')); } catch {}
  send('login-done', { status: await loginStatus(), site: null });
  return true;
});

// ---------- subscriptions ----------
ipcMain.handle('add-sub', (_e, { url, name }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  if (subs.some(s => s.url === url)) return { ok: false, error: 'Already subscribed.' };
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0] || p.host;
  const slug = clean(seg);
  const s = { id: Date.now().toString(36), url, name: name || seg.replace(/^@/, ''), host: p.host,
    folder: path.join(settings.outDir, p.host, slug), last: null, count: 0 };
  subs.push(s); saveSubs(); enqueue(s.id);
  return { ok: true, sub: s };
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
      emit({ src: img ? u : null, label: name, video: !img });
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
            emit({ src: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : null), label: e.title || e.id, video: true });
        } catch {}
      }
      if (me.killed && !idled) return resolve({ ok: false, cancelled: true });
      if (!count) return resolve({ ok: false, error: idled ? 'Preview timed out (no response for 2 minutes).' : (lastErr(err) || 'Nothing found. Log in with 🔑 first if the site requires it.') });
      resolve({ ok: true, count, profile });
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
ipcMain.handle('install-update', () => { if (updater) updater.quitAndInstall(); });
ipcMain.handle('open-release', () => shell.openExternal(RELEASES));

// ---------- boot ----------
app.whenReady().then(() => {
  subs = readJ('subs.json', []);
  settings = Object.assign({ outDir: path.join(app.getPath('pictures'), 'Hoardr'), interval: 0 }, readJ('settings.json', {}));
  createWindow(); schedule(); setupUpdates();
});
app.on('window-all-closed', () => { if (child) child.kill(); if (pchild) pchild.kill(); app.quit(); });
