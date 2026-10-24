const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('helix', Object.freeze({
  snapshot: () => ipcRenderer.invoke('helix:snapshot'),
  onModelState: listener => {
    if (typeof listener !== 'function') throw new TypeError('Model state listener required');
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('helix:model-state', handler);
    return () => ipcRenderer.removeListener('helix:model-state', handler);
  },
  ...(process.argv.includes('--helix-monitor') ? {
    benchmark: () => ipcRenderer.invoke('helix:benchmark'),
    chooseBenchmark: () => ipcRenderer.invoke('helix:choose-benchmark'),
  } : {}),
  readEvidence: (handle, offset, limit) => ipcRenderer.invoke('helix:evidence', handle, offset, limit),
  memorySearch: args => ipcRenderer.invoke('helix:memory-search', args),
  memoryProjects: () => ipcRenderer.invoke('helix:memory-projects'),
  memoryBrowse: args => ipcRenderer.invoke('helix:memory-browse', args),
  memoryRead: args => ipcRenderer.invoke('helix:memory-read', args),
  connectClaudeMem: () => ipcRenderer.invoke('helix:memory-connect'),
  live: () => ipcRenderer.invoke('helix:live'),
  liveSession: id => ipcRenderer.invoke('helix:live-session', id),
  usage: args => ipcRenderer.invoke('helix:usage', args),
  limits: () => ipcRenderer.invoke('helix:limits'),
  runs: () => ipcRenderer.invoke('helix:runs'),
  catalog: () => ipcRenderer.invoke('helix:catalog'),
  settings: () => ipcRenderer.invoke('helix:settings'),
  saveSettings: patch => ipcRenderer.invoke('helix:save-settings', patch),
  copy: text => ipcRenderer.invoke('helix:copy', text),
  shareSnapshot: () => ipcRenderer.invoke('helix:share-snapshot'),
  diagnostics: () => ipcRenderer.invoke('helix:diagnostics'),
  restartCore: () => ipcRenderer.invoke('helix:restart-core'),
}));
