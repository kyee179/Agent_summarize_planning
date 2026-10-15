const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studyCalendar", {
  platform: process.platform,
  isDesktop: true,
  openGoogleConsent: (url) => ipcRenderer.invoke("calendar:google-consent", url),
  request: (route, options) => ipcRenderer.invoke("calendar:request", route, options)
});
