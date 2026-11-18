const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pickDir: () => ipcRenderer.invoke('pick-dir'),
  pickCookies: () => ipcRenderer.invoke('pick-cookies'),
  openDir: p => ipcRenderer.invoke('open-dir', p),
  version: () => ipcRenderer.invoke('version'),
  preview: o => ipcRenderer.invoke('preview', o),
  cancelPreview: () => ipcRenderer.invoke('cancel-preview'),
  start: o => ipcRenderer.invoke('start', o),
  cancel: () => ipcRenderer.invoke('cancel'),
  onLog: cb => ipcRenderer.on('log', (_e, m) => cb(m)),
  onDone: cb => ipcRenderer.on('done', (_e, m) => cb(m))
});
