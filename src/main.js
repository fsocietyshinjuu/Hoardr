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
    width: 1180, height: 780, minWidth: 900, minHeight: 600, backgroundColor: '#0f1117',
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
ipcMain.handle('login', (_e, url) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  const lw = new BrowserWindow({
    width: 540, height: 800, parent: win, title: 'Log in, then close this window',
    webPreferences: { partition: PART, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  lw.setMenuBarVisibility(false);
  lw.webContents.setUserAgent(lw.webContents.userAgent.replace(/\s?(Electron|hoardr)\/\S+/gi, ''));
  lw.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { webPreferences: { partition: PART } } }));
  lw.loadURL(url);
  lw.on('closed', async () => { await exportCookies(); send('login-done', await logins()); });
  return { ok: true };
});
async function logins() {
  const cs = await session.fromPartition(PART).cookies.get({});
  return [...new Set(cs.map(c => c.domain.replace(/^\./, '').split('.').slice(-2).join('.')))].sort();
}
ipcMain.handle('logins', logins);
ipcMain.handle('logout', async () => {
  await session.fromPartition(PART).clearStorageData();
  try { fs.unlinkSync(jp('cookies.txt')); } catch {}
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
ipcMain.handle('cancel', () => { queue = []; if (child) child.kill(); return true; });

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const s = subs.find(x => x.id === queue.shift());
    if (s) await syncOne(s);
  }
  running = false;
}

async function syncOne(s) {
  const p = plan(s.url);
  if (p.error) return log(s.id, 'err', p.error);
  fs.mkdirSync(s.folder, { recursive: true });
  const arch = path.join(settings.outDir, '.hoardr'); fs.mkdirSync(arch, { recursive: true });
  const ck = await exportCookies();
  const args = p.ytdlp
    ? ['-P', s.folder, '-o', '%(title).150B [%(id)s].%(ext)s', '--download-archive', path.join(arch, s.id + '.txt'), '--no-overwrites', '--newline', '--ignore-errors', '--cookies', ck, s.url]
    : ['-D', s.folder, '--download-archive', path.join(arch, s.id + '.sqlite3'), '--cookies', ck, s.url];
  send('state', { id: s.id, running: true });
  log(s.id, 'info', `Checking ${s.name} (${path.basename(p.cmd)})`);
  await new Promise(res => {
    try { child = spawn(p.cmd, args, { windowsHide: true }); } catch (e) { log(s.id, 'err', String(e)); return res(); }
    const pipe = t => d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => log(s.id, t, l));
    child.stdout.on('data', pipe('out')); child.stderr.on('data', pipe('err'));
    child.on('error', e => { log(s.id, 'err', `Could not launch ${path.basename(p.cmd)}: ${e.message}`); res(); });
    child.on('close', code => {
      child = null;
      if (code !== 0) log(s.id, 'err', `Finished with errors (code ${code}). If the site needs login, use 🔑 Log in to a site.`);
      else log(s.id, 'ok', 'Up to date.');
      res();
    });
  });
  s.last = Date.now(); s.count = media(s.folder).length; saveSubs();
  send('state', { id: s.id, running: false });
}

function schedule() {
  clearInterval(timer);
  if (settings.interval > 0) timer = setInterval(() => enqueue('all'), settings.interval * 60000);
}

// ---------- preview ----------
ipcMain.handle('preview', async (_e, { url }) => {
  const p = plan(url);
  if (p.error) return { ok: false, error: p.error };
  if (pchild) { pchild.kill(); pchild = null; }
  const ck = await exportCookies();
  const args = p.ytdlp
    ? ['-J', '--flat-playlist', '--playlist-end', String(PREVIEW_COUNT), '--no-warnings', '--cookies', ck, url]
    : ['-j', '--range', `1-${PREVIEW_COUNT}`, '--cookies', ck, url];
  return new Promise(resolve => {
    let out = '', err = '', timedOut = false;
    try { pchild = spawn(p.cmd, args, { windowsHide: true }); } catch (e) { return resolve({ ok: false, error: String(e) }); }
    const me = pchild;
    const t = setTimeout(() => { timedOut = true; me.kill(); }, 60000);
    me.stdout.on('data', d => { if (out.length < 8e6) out += d; });
    me.stderr.on('data', d => { err += d; });
    me.on('error', e => { clearTimeout(t); resolve({ ok: false, error: `Could not launch ${path.basename(p.cmd)}: ${e.message}` }); });
    me.on('close', () => {
      clearTimeout(t); if (pchild === me) pchild = null;
      if (timedOut) return resolve({ ok: false, error: 'Preview timed out.' });
      try {
        let profile = '', items = [];
        if (p.ytdlp) {
          const o = JSON.parse(out);
          profile = o.uploader || o.channel || o.title || '';
          items = (o.entries || [o]).filter(Boolean).map(e => ({
            src: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : null), label: e.title || e.id, video: true }));
        } else {
          for (const x of JSON.parse(out)) {
            if (x[0] === 2 && !profile) {
              const m = x[1] || {};
              profile = (m.user && (m.user.nick || m.user.name || m.user.username)) || (m.author && (m.author.nick || m.author.name)) || m.username || '';
            } else if (x[0] === 3) {
              const m = x[2] || {}, ext = String(m.extension || '').toLowerCase(), img = IMG.includes(ext);
              items.push({ src: img ? x[1] : (m.thumbnail || null), label: (m.filename || 'file') + (ext ? '.' + ext : ''), video: !img });
            }
          }
        }
        if (!items.length) return resolve({ ok: false, error: lastErr(err) || 'Nothing found. Log in with 🔑 first if the site requires it.' });
        resolve({ ok: true, profile, items });
      } catch { resolve({ ok: false, error: lastErr(err) || 'Could not read preview data.' }); }
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
