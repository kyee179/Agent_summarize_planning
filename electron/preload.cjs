const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("studyCalendar", {
  platform: process.platform,
  isDesktop: true,
  request: (route, options) => ipcRenderer.invoke("calendar:request", route, options)
});
