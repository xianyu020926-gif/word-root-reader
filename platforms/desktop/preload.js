const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wordApp', {
  request: payload => ipcRenderer.invoke('deepseek:request', payload),
  saveBackup: payload => ipcRenderer.invoke('learning:save-backup', payload),
  platform: process.platform,
  desktop: true
});
