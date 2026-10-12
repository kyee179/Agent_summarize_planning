const path = require("node:path");
const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
const crypto = require("node:crypto");
const { startServer } = require("../server/index.cjs");
const { isAllowedRequest, trustedSender } = require("./apiBridge.cjs");
const { loadEnvironment } = require("../server/environment.cjs");
const { DEV_ORIGIN } = require("../server/security.cjs");

let mainWindow;
let apiServer;
let apiToken;
const pageFile = path.join(__dirname, "..", "dist", "index.html");
let startUrl;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    title: "Agent Planning Calendar",
    backgroundColor: "#f8fafc",
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
  startUrl = !app.isPackaged ? process.env.ELECTRON_START_URL : undefined;
  if (startUrl && startUrl !== DEV_ORIGIN) throw new Error("Electron development URL must be the trusted Vite origin");
  apiToken = crypto.randomBytes(32).toString("hex");
  const dataFile = process.env.CALENDAR_DB_PATH || (app.isPackaged ? path.join(app.getPath("userData"), "calendar.sqlite")
    : path.join(__dirname, "..", "server", "data", "calendar.sqlite"));
  apiServer = startServer({ port: 0, dataFile, apiToken, envFile: false });
  await new Promise((resolve, reject) => { apiServer.once("listening", resolve); apiServer.once("error", reject); });
  ipcMain.handle("calendar:request", async (event, route, options = {}) => {
    if (!trustedSender(event, mainWindow?.webContents, pageFile, startUrl)) throw new Error("Untrusted IPC sender");
    const method = options.method || "GET";
    if (!isAllowedRequest(route, method) || (options.body !== undefined && (typeof options.body !== "string" || Buffer.byteLength(options.body) > 2 * 1024 * 1024))) {
      throw new Error("Invalid calendar request");
    }
    const response = await fetch(`http://127.0.0.1:${apiServer.address().port}${route}`, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
      body: options.body, redirect: "error", signal: AbortSignal.timeout(120000)
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
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
  if (apiServer) apiServer.close();
});
