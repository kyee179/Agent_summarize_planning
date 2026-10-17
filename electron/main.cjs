const path = require("node:path");
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, Notification, powerMonitor } = require("electron");
const { createCredentials } = require('./credentials.cjs');
const { createReminders } = require('./reminders.cjs');
const { createPrivateVault } = require('./privateVault.cjs');
const { createSessionBridge } = require('./sessionBridge.cjs');
const crypto = require("node:crypto");
const { startServer } = require("../server/index.cjs");
const { isAllowedRequest, trustedSender } = require("./apiBridge.cjs");
const { loadEnvironment } = require("../server/environment.cjs");
const { DEV_ORIGIN } = require("../server/security.cjs");

let mainWindow;
let apiServer;
let apiToken;
let reminders;
let sessionBridge;
const notifications = new Set();
let shuttingDown = false;
const pageFile = path.join(__dirname, "..", "dist", "index.html");
let startUrl;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 640,
    minHeight: 600,
    title: "Agent Planning Calendar",
    backgroundColor: "#f5f5f7",
    show: process.env.CALENDAR_SMOKE_TEST !== "1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(pageFile);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
}

function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "toggleDevTools" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

if (primaryInstance) app.whenReady().then(async () => {
  loadEnvironment(app.isPackaged ? path.join(app.getPath("userData"), ".env") : undefined);
  const credentials = createCredentials({ file: path.join(app.getPath('userData'), 'credentials.encrypted'), safeStorage });
  credentials.load();
  startUrl = !app.isPackaged ? process.env.ELECTRON_START_URL : undefined;
  if (startUrl && startUrl !== DEV_ORIGIN) throw new Error("Electron development URL must be the trusted Vite origin");
  apiToken = crypto.randomBytes(32).toString("hex");
  const dataFile = process.env.CALENDAR_DB_PATH || (app.isPackaged ? path.join(app.getPath("userData"), "calendar.sqlite")
    : path.join(__dirname, "..", "server", "data", "calendar.sqlite"));
  sessionBridge = createSessionBridge({ address: () => apiServer?.address(), apiToken });
  const vault = createPrivateVault({ file: path.join(app.getPath('userData'), 'session.encrypted'), safeStorage });
  apiServer = startServer({ port: 0, dataFile, apiToken, envFile: false, vault,
    credentialsFactory: options => createCredentials({ ...options, safeStorage }),
    onProfileChange: store => {
      sessionBridge.changed(); reminders?.stop(); reminders = null;
      for (const notification of notifications) notification.close(); notifications.clear();
      if (!store) return;
      reminders = createReminders({ store, supported: () => process.env.CALENDAR_SMOKE_TEST !== '1' && Notification.isSupported(),
        notify: options => { const notification = new Notification(options); notifications.add(notification);
          notification.on('close', () => notifications.delete(notification));
          notification.on('failed', () => { notifications.delete(notification); try { store.releaseReminder(options.tag); } catch { /* The profile may have closed. */ } }); notification.show(); } });
      reminders.start();
    } });
  await new Promise((resolve, reject) => { apiServer.once("listening", resolve); apiServer.once("error", reject); });
  try { const restored = await apiServer.profileGateway.restore(); sessionBridge.restore(restored?.token); } catch { /* Start at sign-in after an expired or unavailable session. */ }
  async function setupRequest(route, options) {
    const result = await sessionBridge.request(route, options);
    if (result.status >= 400) throw new Error(result.body?.error || 'Service setup failed.');
    return result.body;
  }
  ipcMain.handle('calendar:setup-status', event => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error('Untrusted setup request');
    return setupRequest('/api/account/services');
  });
  ipcMain.handle('calendar:setup-save', (event, input) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl) || Buffer.byteLength(JSON.stringify(input) || '') > 32768) throw new Error('Invalid setup request');
    return setupRequest('/api/account/services', { method: 'POST', body: JSON.stringify(input) });
  });
  ipcMain.handle('calendar:restart', event => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error('Untrusted restart request');
    app.relaunch(); app.quit();
  });
  powerMonitor.on('resume', () => { try { reminders?.check(); } catch { /* timer retries */ } });
  ipcMain.handle("calendar:request", async (event, route, options = {}) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error("Untrusted IPC sender");
    const method = options.method || "GET";
    if (!isAllowedRequest(route, method) || (options.body !== undefined && (typeof options.body !== "string" || Buffer.byteLength(options.body) > 2 * 1024 * 1024))) {
      throw new Error("Invalid calendar request");
    }
    const closing = () => ({ status: 503, body: { error: 'The app is closing.' } });
    const address = apiServer?.address();
    if (shuttingDown || !address) return closing();
    try {
      return await sessionBridge.request(route, { method, body: options.body });
    } catch (error) { if (shuttingDown) return closing(); throw error; }
  });
  ipcMain.handle('calendar:google-consent', async (event, url) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl) || typeof url !== 'string' || url.length > 8192) throw new Error('Untrusted Google consent request');
    if (!sessionBridge.permitsConsent(url)) throw new Error('Start Google sign-in from the current workspace.');
    const target = new URL(url);
    if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') throw new Error('Invalid Google consent URL');
    await shell.openExternal(target.href); return { opened: true };
  });
  createMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => { console.error(`Desktop startup failed: ${error.message}`); app.quit(); });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  shuttingDown = true;
  reminders?.stop();
  sessionBridge?.close();
  for (const notification of notifications) notification.close();
  if (apiServer) apiServer.close();
});
