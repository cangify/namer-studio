const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('aglove', {
  pickVideos: () => ipcRenderer.invoke('dialog:pickVideos'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  importTemplateFile: () => ipcRenderer.invoke('template:importFile'),
  exportTemplateFile: (data) => ipcRenderer.invoke('template:exportFile', data),
  droppedFilePaths: (files) => Array.from(files || []).map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  resolveDropped: (paths) => ipcRenderer.invoke('files:resolveDropped', paths),
  saveScreenshots: (data) => ipcRenderer.invoke('screenshots:save', data),
  captureScreenshots: (data) => ipcRenderer.invoke('screenshots:captureFfmpeg', data),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  renameFile: (data) => ipcRenderer.invoke('file:rename', data),
  trashFiles: (paths) => ipcRenderer.invoke('file:trash', paths),
  ollamaInstalled: () => ipcRenderer.invoke('ollama:installed'),
  ollamaTags: (data) => ipcRenderer.invoke('ollama:tags', data),
  ollamaGenerate: (data) => ipcRenderer.invoke('ollama:generate', data),
  getSidebarAd: () => ipcRenderer.invoke('ads:getSidebarAd'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});

window.addEventListener('drop', (event) => {
  try {
    const paths = Array.from(event.dataTransfer?.files || [])
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean);
    if (paths.length) {
      window.postMessage({ type: 'aglove:dropped-paths', paths }, '*');
    }
  } catch (_) {}
}, true);
