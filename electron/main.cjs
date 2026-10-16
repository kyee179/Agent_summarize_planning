const path = require("node:path");
const { app, BrowserWindow, Menu, shell, ipcMain, safeStorage, Notification, powerMonitor } = require("electron");
const { createCredentials } = require('./credentials.cjs');
const { createReminders } = require('./reminders.cjs');
const crypto = require("node:crypto");
const { startServer } = require("../server/index.cjs");
const { isAllowedRequest, trustedSender } = require("./apiBridge.cjs");
const { loadEnvironment } = require("../server/environment.cjs");
const { DEV_ORIGIN } = require("../server/security.cjs");

let mainWindow;
let apiServer;
let apiToken;
let reminders;
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

app.whenReady().then(async () => {
  loadEnvironment(app.isPackaged ? path.join(app.getPath("userData"), ".env") : undefined);
  const credentials = createCredentials({ file: path.join(app.getPath('userData'), 'credentials.encrypted'), safeStorage });
  credentials.load();
  startUrl = !app.isPackaged ? process.env.ELECTRON_START_URL : undefined;
  if (startUrl && startUrl !== DEV_ORIGIN) throw new Error("Electron development URL must be the trusted Vite origin");
  apiToken = crypto.randomBytes(32).toString("hex");
  const dataFile = process.env.CALENDAR_DB_PATH || (app.isPackaged ? path.join(app.getPath("userData"), "calendar.sqlite")
    : path.join(__dirname, "..", "server", "data", "calendar.sqlite"));
  apiServer = startServer({ port: 0, dataFile, apiToken, envFile: false });
  await new Promise((resolve, reject) => { apiServer.once("listening", resolve); apiServer.once("error", reject); });
  ipcMain.handle('calendar:setup-status', event => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error('Untrusted setup request');
    return credentials.status();
  });
  ipcMain.handle('calendar:setup-save', (event, input) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl) || Buffer.byteLength(JSON.stringify(input) || '') > 32768) throw new Error('Invalid setup request');
    return credentials.save(input);
  });
  ipcMain.handle('calendar:restart', event => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error('Untrusted restart request');
    app.relaunch(); app.quit();
  });
  reminders = createReminders({ store: apiServer.calendarStore, supported: () => process.env.CALENDAR_SMOKE_TEST !== '1' && Notification.isSupported(),
    notify: options => { const notification = new Notification(options); notification.on('failed', () => apiServer.calendarStore.releaseReminder(options.tag)); notification.show(); } });
  reminders.start();
  powerMonitor.on('resume', () => { try { reminders.check(); } catch { /* timer retries */ } });
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
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
        method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
        body: options.body, redirect: "error", signal: AbortSignal.timeout(120000)
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    } catch (error) { if (shuttingDown) return closing(); throw error; }
  });
  ipcMain.handle('calendar:google-consent', async (event, url) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl) || typeof url !== 'string' || url.length > 8192) throw new Error('Untrusted Google consent request');
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
  if (apiServer) apiServer.close();
});
