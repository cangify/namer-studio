const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aglove', {
  pickVideos: () => ipcRenderer.invoke('dialog:pickVideos'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  renameFile: (data) => ipcRenderer.invoke('file:rename', data),
  ollamaTags: (data) => ipcRenderer.invoke('ollama:tags', data),
  ollamaGenerate: (data) => ipcRenderer.invoke('ollama:generate', data),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
