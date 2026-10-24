const { app, BrowserWindow, shell, Menu, session } = require("electron");
const path = require("path");

const APP_URL = "https://hakedis-takip-3.emergent.host";
const APP_HOST = new URL(APP_URL).host;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("com.devrantas.yapi");

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    title: "Devrantaş", backgroundColor: "#FDFBF7", autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(APP_URL);

  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile(path.join(__dirname, "offline.html"), { query: { back: url || APP_URL } });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).host === APP_HOST) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const h = new URL(url).host;
    if (h !== APP_HOST && !url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on("page-title-updated", (e) => { e.preventDefault(); win.setTitle("Devrantaş"); });
}

const menu = Menu.buildFromTemplate([
  { label: "Devrantaş", submenu: [
    { label: "Ana sayfa", accelerator: "CmdOrCtrl+H", click: () => win?.loadURL(APP_URL) },
    { label: "Yenile", accelerator: "F5", click: () => win?.reload() },
    { label: "Yazdır", accelerator: "CmdOrCtrl+P", click: () => win?.webContents.print() },
    { type: "separator" },
    { label: "Yakınlaştır", role: "zoomIn" }, { label: "Uzaklaştır", role: "zoomOut" }, { label: "Normal boyut", role: "resetZoom" },
    { type: "separator" },
    { label: "Tam ekran", role: "togglefullscreen" },
    { label: "Çıkış", role: "quit" },
  ] },
  { label: "Düzen", submenu: [{ role: "undo", label: "Geri al" }, { role: "redo", label: "Yinele" }, { type: "separator" }, { role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { role: "selectAll", label: "Tümünü seç" }] },
]);
Menu.setApplicationMenu(menu);

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(["notifications", "media", "clipboard-read", "clipboard-sanitized-write"].includes(permission)));
  session.defaultSession.on("will-download", (_e, item) => item.once("done", (_ev, state) => { if (state === "completed") shell.showItemInFolder(item.getSavePath()); }));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
