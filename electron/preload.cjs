const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studyCalendar", {
  platform: process.platform,
  isDesktop: true,
  nativeReminders: true,
  setupStatus: () => ipcRenderer.invoke('calendar:setup-status'),
  saveSetup: (input) => ipcRenderer.invoke('calendar:setup-save', input),
  restart: () => ipcRenderer.invoke('calendar:restart'),
  openGoogleConsent: (url) => ipcRenderer.invoke("calendar:google-consent", url),
  request: (route, options) => ipcRenderer.invoke("calendar:request", route, options)
});
