const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Paid / subscriber-only platforms are intentionally unsupported.
const BLOCKED = ['onlyfans.com', 'fantia.jp'];
const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'dailymotion.com'];
const IMG_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];
const PREVIEW_COUNT = 24;

let win, child, pchild;

function binPath(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const dirs = [path.join(process.resourcesPath || '', 'bin'), path.join(__dirname, '..', 'bin')];
  for (const d of dirs) { const p = path.join(d, exe); if (fs.existsSync(p)) return p; }
  return name; // fall back to PATH
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } }
const matches = (h, list) => list.some(d => h === d || h.endsWith('.' + d));

// Shared validation + engine choice
function plan(url, mode) {
  const host = hostOf(url);
  if (!host) return { error: 'That does not look like a valid URL.' };
  if (matches(host, BLOCKED)) return { error: 'This platform serves paid, subscriber-only content and is not supported by Hoardr.' };
  const ytdlp = mode === 'video' || (mode === 'auto' && matches(host, VIDEO_HOSTS));
  return { host, ytdlp, cmd: binPath(ytdlp ? 'yt-dlp' : 'gallery-dl') };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000, height: 780, minWidth: 760, minHeight: 600, backgroundColor: '#0f1117',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('pick-dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-cookies', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Cookies (Netscape)', extensions: ['txt'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-dir', (_e, p) => shell.openPath(p));
ipcMain.handle('version', () => app.getVersion());

// ---------- Preview: list items without downloading ----------
ipcMain.handle('preview', (_e, { url, cookies, mode }) => new Promise(resolve => {
  const p = plan(url, mode);
  if (p.error) return resolve({ ok: false, error: p.error });
  if (pchild) { pchild.kill(); pchild = null; }

  const args = p.ytdlp
    ? ['-J', '--flat-playlist', '--playlist-end', String(PREVIEW_COUNT), '--no-warnings']
    : ['-j', '--range', `1-${PREVIEW_COUNT}`];
  if (cookies) args.push('--cookies', cookies);
  args.push(url);

  let out = '', err = '', timedOut = false;
  try { pchild = spawn(p.cmd, args, { windowsHide: true }); }
  catch (e) { return resolve({ ok: false, error: String(e) }); }
  const me = pchild;
  const timer = setTimeout(() => { timedOut = true; me.kill(); }, 60000);
  me.stdout.on('data', d => { if (out.length < 8e6) out += d; });
  me.stderr.on('data', d => { err += d; });
  me.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: `Could not launch ${path.basename(p.cmd)}: ${e.message}` }); });
  me.on('close', () => {
    clearTimeout(timer);
    if (pchild === me) pchild = null;
    if (timedOut) return resolve({ ok: false, error: 'Preview timed out. The site may be slow or require login (try a cookies file).' });
    try {
      let profile = '', items = [];
      if (p.ytdlp) {
        const o = JSON.parse(out);
        const list = o.entries || [o];
        profile = o.uploader || o.channel || o.title || '';
        items = list.filter(Boolean).map(e => ({
          thumb: e.thumbnail || (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : null),
          label: e.title || e.id || 'Video', video: true
        }));
      } else {
        const arr = JSON.parse(out);
        for (const x of arr) {
          if (x[0] === 2 && x[1] && !profile) {
            const m = x[1];
            profile = (m.user && (m.user.full_name || m.user.name || m.user.nick || m.user.username)) ||
                      (m.author && (m.author.name || m.author.nick)) || m.username || m.uploader || '';
          } else if (x[0] === 3) {
            const m = x[2] || {};
            const ext = String(m.extension || '').toLowerCase();
            const isImg = IMG_EXT.includes(ext);
            items.push({ thumb: isImg ? x[1] : (m.thumbnail || null), label: (m.filename || 'file') + (ext ? '.' + ext : ''), video: !isImg });
          }
        }
      }
      if (!items.length) return resolve({ ok: false, error: (err.trim().split('\n').pop()) || 'Nothing found. The profile may be private or need a cookies file.' });
      resolve({ ok: true, profile, items, limit: PREVIEW_COUNT });
    } catch {
      resolve({ ok: false, error: (err.trim().split('\n').pop()) || 'Could not read preview data.' });
    }
  });
}));

ipcMain.handle('cancel-preview', () => { if (pchild) { pchild.kill(); pchild = null; } return true; });

// ---------- Download ----------
ipcMain.handle('start', (_e, { url, outDir, cookies, mode, rateLimit }) => {
  const send = (type, text) => win.webContents.send('log', { type, text });
  const p = plan(url, mode);
  if (p.error) return { ok: false, error: p.error };
  if (!outDir) return { ok: false, error: 'Choose an output folder first.' };
  if (child) return { ok: false, error: 'A download is already running.' };

  let args;
  if (p.ytdlp) {
    args = ['-P', outDir, '-o', '%(uploader)s/%(title).150B [%(id)s].%(ext)s', '--no-overwrites', '--newline', '--ignore-errors'];
  } else {
    args = ['-d', outDir, '--write-metadata'];
  }
  if (cookies) args.push('--cookies', cookies);
  if (rateLimit) args.push('--limit-rate', rateLimit);
  args.push(url);

  send('info', `Using ${path.basename(p.cmd)} for ${p.host}`);
  try { child = spawn(p.cmd, args, { windowsHide: true }); }
  catch (err) { child = null; return { ok: false, error: String(err) }; }
  const pipe = t => d => d.toString().split(/\r?\n/).filter(Boolean).forEach(l => send(t, l));
  child.stdout.on('data', pipe('out'));
  child.stderr.on('data', pipe('err'));
  child.on('error', err => { send('err', `Could not launch ${p.cmd}: ${err.message}`); child = null; win.webContents.send('done', { code: -1 }); });
  child.on('close', code => { child = null; win.webContents.send('done', { code }); });
  return { ok: true };
});

ipcMain.handle('cancel', () => { if (child) { child.kill(); child = null; } return true; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (child) child.kill(); if (pchild) pchild.kill(); app.quit(); });
