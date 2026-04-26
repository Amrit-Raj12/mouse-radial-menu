const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Re-launch as admin if not already elevated ────────────────────────────────
function isElevated() {
  try {
    require('child_process').execSync('net session', { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function relaunchAsAdmin() {
  const { execSync } = require('child_process');
  const exePath = process.execPath;
  const args = process.argv.slice(1).join(' ');
  try {
    execSync(
      `powershell -WindowStyle Hidden -Command "Start-Process -FilePath '${exePath}' -ArgumentList '${args}' -Verb RunAs"`,
      { stdio: 'ignore' }
    );
  } catch(e) {
    dialog.showErrorBox('Admin Required',
      'Radial Menu needs Administrator rights to detect mouse buttons.\nPlease right-click the exe and choose "Run as administrator".');
  }
  app.exit(0);
}

// Check elevation before anything else
if (process.platform === 'win32' && !isElevated() && !process.env.RADIAL_SKIP_ADMIN) {
  app.whenReady().then(() => relaunchAsAdmin());
  // Don't continue setup
} else {
  initApp();
}

function initApp() {

let menuWindow = null;
let settingsWindow = null;
let tray = null;
let isMenuVisible = false;
let mouseWatcherProcess = null;

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'shortcuts.json');

const DEFAULT_SHORTCUTS = [
  { id:'file-explorer',    label:'Explorer',   icon:'📁', angle:315, bg:'linear-gradient(135deg,#1a73e8,#0d47a1)', type:'app',     value:'explorer.exe' },
  { id:'play-pause',       label:'Play/Pause', icon:'▶️',  angle:0,   bg:'linear-gradient(135deg,#43a047,#1b5e20)', type:'media',   value:'play-pause' },
  { id:'task-notes',       label:'Notepad',    icon:'📝', angle:45,  bg:'linear-gradient(135deg,#fb8c00,#e65100)', type:'app',     value:'notepad.exe' },
  { id:'ai-magic',         label:'Claude AI',  icon:'✨', angle:90,  bg:'linear-gradient(135deg,#8e24aa,#4a148c)', type:'url',     value:'https://claude.ai' },
  { id:'display-settings', label:'Display',    icon:'🖥️', angle:135, bg:'linear-gradient(135deg,#00acc1,#006064)', type:'settings',value:'ms-settings:display' },
  { id:'screenshot',       label:'Screenshot', icon:'📸', angle:180, bg:'linear-gradient(135deg,#e53935,#b71c1c)', type:'shortcut',value:'win+shift+s' },
  { id:'emoji-picker',     label:'Emoji',      icon:'😊', angle:225, bg:'linear-gradient(135deg,#f4c430,#f57f17)', type:'shortcut',value:'win+.' },
  { id:'mouse-settings',   label:'Mouse',      icon:'🖱️', angle:270, bg:'linear-gradient(135deg,#546e7a,#263238)', type:'settings',value:'control main.cpl' },
];

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch(e) {}
  return DEFAULT_SHORTCUTS;
}

function saveConfig(shortcuts) {
  if (!shortcuts) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_SHORTCUTS, null, 2), 'utf8');
    return;
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(shortcuts, null, 2), 'utf8');
}

// ── Menu window ───────────────────────────────────────────────────────────────
function createMenuWindow() {
  menuWindow = new BrowserWindow({
    width: 380, height: 380,
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, show: false, focusable: true,
    icon: getIconPath(),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  menuWindow.loadFile(path.join(__dirname, 'index.html'));
  menuWindow.setAlwaysOnTop(true, 'screen-saver');
  menuWindow.on('blur', () => {
    setTimeout(() => { if (isMenuVisible) hideMenu(); }, 150);
  });
}

// ── Settings window ───────────────────────────────────────────────────────────
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus(); return;
  }
  settingsWindow = new BrowserWindow({
    width: 700, height: 620,
    frame: true, transparent: false,
    resizable: true,
    title: 'Radial Menu — Shortcuts',
    icon: getIconPath(),
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function getIconPath() {
  const icoPath = path.join(__dirname, 'icon.ico');
  const pngPath = path.join(__dirname, 'icon.png');
  if (fs.existsSync(icoPath)) return icoPath;
  if (fs.existsSync(pngPath)) return pngPath;
  return null;
}

function showMenu(x, y) {
  if (!menuWindow || isMenuVisible) return;
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const W = 380, H = 380;
  let wx = Math.max(0, Math.min(Math.round(x - W/2), sw - W));
  let wy = Math.max(0, Math.min(Math.round(y - H/2), sh - H));
  menuWindow.setPosition(wx, wy);
  menuWindow.show();
  menuWindow.focus();
  setTimeout(() => menuWindow.webContents.send('show-menu', loadConfig()), 30);
  isMenuVisible = true;
}

function hideMenu() {
  if (!menuWindow || !isMenuVisible) return;
  isMenuVisible = false;
  menuWindow.webContents.send('hide-menu');
  setTimeout(() => { if (menuWindow) menuWindow.hide(); }, 280);
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.on('hide-menu', () => hideMenu());
ipcMain.on('execute-action', (_e, shortcut) => {
  hideMenu();
  setTimeout(() => performAction(shortcut), 300);
});
ipcMain.handle('get-shortcuts', () => loadConfig());
ipcMain.handle('save-shortcuts', (_e, shortcuts) => { saveConfig(shortcuts); return true; });
ipcMain.on('open-settings', () => openSettingsWindow());

// ── Actions ───────────────────────────────────────────────────────────────────
function performAction(sc) {
  switch(sc.type) {
    case 'app':      exec(sc.value); break;
    case 'url':      exec(`start ${sc.value}`, { shell: true }); break;
    case 'folder':   exec(`explorer.exe "${sc.value}"`); break;
    case 'settings': sc.value.startsWith('ms-settings:') ? exec(`start ${sc.value}`, { shell: true }) : exec(sc.value); break;
    case 'media':    psKey([[0xB3,false],[0xB3,true]]); break;
    case 'shortcut': sendCombo(sc.value); break;
  }
}

function psKey(actions) {
  const td = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class KBH { [DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte a,byte b,uint c,int d); }'`;
  const calls = actions.map(([vk,up]) => `[KBH]::keybd_event(${vk},0,${up?2:0},0)`).join('; ');
  exec(`powershell -NoProfile -WindowStyle Hidden -Command "${td}; ${calls}"`);
}

function sendCombo(combo) {
  const M = { 'win':0x5B,'ctrl':0x11,'alt':0x12,'shift':0x10,'a':0x41,'b':0x42,'c':0x43,'d':0x44,'e':0x45,'f':0x46,'g':0x47,'h':0x48,'i':0x49,'j':0x4A,'k':0x4B,'l':0x4C,'m':0x4D,'n':0x4E,'o':0x4F,'p':0x50,'q':0x51,'r':0x52,'s':0x53,'t':0x54,'u':0x55,'v':0x56,'w':0x57,'x':0x58,'y':0x59,'z':0x5A,'.':0xBE,',':0xBC,'/':0xBF,'f1':0x70,'f2':0x71,'f3':0x72,'f4':0x73,'f5':0x74,'f6':0x75,'f7':0x76,'f8':0x77,'f9':0x78,'f10':0x79,'f11':0x7A,'f12':0x7B,'space':0x20,'enter':0x0D,'esc':0x1B,'tab':0x09,'del':0x2E,'0':0x30,'1':0x31,'2':0x32,'3':0x33,'4':0x34,'5':0x35,'6':0x36,'7':0x37,'8':0x38,'9':0x39 };
  const keys = combo.toLowerCase().split('+').map(k => M[k.trim()]).filter(Boolean);
  if (!keys.length) return;
  psKey([...keys.map(v=>[v,false]), ...[...keys].reverse().map(v=>[v,true])]);
}

// ── Mouse watcher ─────────────────────────────────────────────────────────────
function startMouseWatcher() {
  if (process.platform !== 'win32') return;

  const psCode = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices;',
    'public class RMouse {',
    '  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int v);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);',
    '  public struct POINT { public int X; public int Y; }',
    '  public static bool Mid() { return (GetAsyncKeyState(4) & 0x8000) != 0; }',
    '  public static POINT Pos() { POINT p; GetCursorPos(out p); return p; }',
    '}',
    '"@',
    '$held=$false; $ticks=0; $TRIGGER=4',
    'while($true){',
    '  $d=[RMouse]::Mid()',
    '  if($d){ $ticks++; if($ticks -eq $TRIGGER -and -not $held){ $p=[RMouse]::Pos(); [Console]::WriteLine("SHOW:"+$p.X+":"+$p.Y); [Console]::Out.Flush(); $held=$true } }',
    '  else{ $ticks=0; $held=$false }',
    '  Start-Sleep -Milliseconds 25',
    '}',
  ].join('\r\n');

  const scriptPath = path.join(os.tmpdir(), 'radial_watcher.ps1');
  fs.writeFileSync(scriptPath, psCode, 'utf8');

  mouseWatcherProcess = spawn('powershell.exe', [
    '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File', scriptPath
  ], { stdio: ['ignore','pipe','ignore'] });

  let buf = '';
  mouseWatcherProcess.stdout.on('data', chunk => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('SHOW:')) {
        const [,xs,ys] = line.split(':');
        const x = parseInt(xs,10), y = parseInt(ys,10);
        if (!isNaN(x) && !isNaN(y)) showMenu(x, y);
      }
    }
  });
  mouseWatcherProcess.on('error', err => console.error('Watcher error:', err));
  mouseWatcherProcess.on('exit', code => {
    if (code !== 0 && !app.isQuitting) setTimeout(startMouseWatcher, 2000);
  });
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = getIconPath();
  let icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Radial Menu — Hold Middle Mouse Button');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🖱️  Radial Menu', enabled: false },
    { label: 'Hold middle mouse to open', enabled: false },
    { type: 'separator' },
    { label: '⚙️  Manage Shortcuts', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => openSettingsWindow());
}

// ── Show startup notification ─────────────────────────────────────────────────
function showStartupNotification() {
  // Use tray balloon (works on all Windows without notification permission)
  setTimeout(() => {
    try {
      tray.displayBalloon({
        iconType: 'info',
        title: '🖱️ Radial Menu is Running',
        content: 'Hold middle mouse button to open shortcuts.\nRight-click tray icon to manage.',
      });
    } catch(e) {}
  }, 1000);
}

// ── App ready ─────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createMenuWindow();
  createTray();
  startMouseWatcher();
  showStartupNotification();

  globalShortcut.register('CommandOrControl+Space', () => {
    if (isMenuVisible) hideMenu();
    else { const {x,y} = screen.getCursorScreenPoint(); showMenu(x,y); }
  });
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => {
  if (mouseWatcherProcess) mouseWatcherProcess.kill();
  globalShortcut.unregisterAll();
});

} // end initApp