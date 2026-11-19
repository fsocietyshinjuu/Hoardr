const { contextBridge, ipcRenderer } = require('electron');
const inv = c => (...a) => ipcRenderer.invoke(c, ...a);
const on = c => cb => ipcRenderer.on(c, (_e, m) => cb(m));
contextBridge.exposeInMainWorld('api', {
  state: inv('state'), pickDir: inv('pick-dir'), setInterval: inv('set-interval'),
  openPath: inv('open-path'), openFolder: inv('open-folder'),
  login: inv('login'), logins: inv('logins'), logout: inv('logout'),
  addSub: inv('add-sub'), removeSub: inv('remove-sub'), media: inv('media'),
  sync: inv('sync'), cancel: inv('cancel'), cancelPreview: inv('cancel-preview'), setTypes: inv('set-types'), showFile: inv('show-file'), onQueue: on('queue'), preview: inv('preview'),
  checkUpdate: inv('check-update'), installUpdate: inv('install-update'), openRelease: inv('open-release'),
  onUpdate: on('update'),
  importCookies: inv('import-cookies'), setXCookies: inv('set-x-cookies'), onPreviewProfile: on('preview-profile'),
  onLog: on('log'), onProgress: on('progress'), onPreviewItem: on('preview-item'), onSubs: on('subs'), onState: on('state'), onLogin: on('login-done')
});
