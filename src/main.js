const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.webm', '.m4v']);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: 'Ai视频自动命名工具',
    autoHideMenuBar: true,
    backgroundColor: '#f6f7fb',
    icon: path.join(__dirname, 'assets', 'logo-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function configPath() {
  const portable = path.join(app.getAppPath(), 'aglove-renamer-settings.json');
  try {
    fsSync.accessSync(path.dirname(portable), fsSync.constants.W_OK);
    return portable;
  } catch (_) {
    return path.join(app.getPath('userData'), 'aglove-renamer-settings.json');
  }
}

function walkVideos(dir, result = []) {
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkVideos(full, result);
    else if (VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) result.push(full);
  }
  return result;
}

ipcMain.handle('dialog:pickVideos', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择视频',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '视频文件', extensions: [...VIDEO_EXTS].map((x) => x.slice(1)) }, { name: '所有文件', extensions: ['*'] }],
  });
  return canceled ? [] : filePaths;
});

ipcMain.handle('dialog:pickFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title: '选择视频文件夹', properties: ['openDirectory'] });
  if (canceled || !filePaths[0]) return [];
  return walkVideos(filePaths[0]);
});

ipcMain.handle('settings:load', async () => {
  try {
    return JSON.parse(await fs.readFile(configPath(), 'utf8'));
  } catch (_) {
    return null;
  }
});

ipcMain.handle('settings:save', async (_event, data) => {
  await fs.mkdir(path.dirname(configPath()), { recursive: true });
  await fs.writeFile(configPath(), JSON.stringify(data, null, 2), 'utf8');
  return configPath();
});

ipcMain.handle('files:resolveDropped', async (_event, paths) => {
  const result = [];
  for (const p of paths || []) {
    try {
      const stat = fsSync.statSync(p);
      if (stat.isDirectory()) result.push(...walkVideos(p));
      else if (stat.isFile() && VIDEO_EXTS.has(path.extname(p).toLowerCase())) result.push(p);
    } catch (_) {}
  }
  return [...new Set(result)];
});

ipcMain.handle('file:rename', async (_event, { filePath, newBaseName }) => {
  const parsed = path.parse(filePath);
  const ext = parsed.ext.toLowerCase();
  let target = path.join(parsed.dir, `${newBaseName}${ext}`);
  let n = 2;
  while (fsSync.existsSync(target) && path.resolve(target) !== path.resolve(filePath)) {
    target = path.join(parsed.dir, `${newBaseName}_${n}${ext}`);
    n += 1;
  }
  await fs.rename(filePath, target);
  return target;
});


ipcMain.handle('ollama:installed', async () => new Promise((resolve) => {
  execFile('ollama', ['--version'], { timeout: 5000 }, (error, stdout, stderr) => {
    if (error) return resolve({ installed: false });
    resolve({ installed: true, version: String(stdout || stderr || '').trim() });
  });
}));

ipcMain.handle('ollama:tags', async (_event, { baseUrl, timeout = 10000 }) => {
  const data = await requestJson(`${String(baseUrl).replace(/\/$/, '')}/api/tags`, null, timeout);
  return (data.models || []).map((m) => m.name).filter(Boolean).sort();
});

ipcMain.handle('ollama:generate', async (_event, { baseUrl, model, prompt, images, timeout = 900000 }) => {
  const cleanBase = String(baseUrl).replace(/\/$/, '');
  const generatePayload = {
    model,
    prompt,
    images,
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: 16384,
      num_predict: 768,
    },
  };

  const gen = await requestJson(`${cleanBase}/api/generate`, generatePayload, timeout);
  const genText = String(gen.response || '').trim();
  if (genText) return genText;

  const chatPayload = {
    model,
    stream: false,
    messages: [{ role: 'user', content: prompt, images }],
    options: {
      temperature: 0.1,
      num_ctx: 16384,
      num_predict: 768,
    },
  };
  const chat = await requestJson(`${cleanBase}/api/chat`, chatPayload, timeout);
  const chatText = String(chat.message?.content || chat.response || '').trim();
  if (chatText) return chatText;

  const reason = gen.done_reason || chat.done_reason || gen.error || chat.error || '';
  throw new Error(`Ollama 没有返回内容${reason ? `（${reason}）` : ''}。请确认当前模型支持图片/视觉输入，建议选择 qwen3-vl 或其他视觉模型。`);
});

function requestJson(urlString, payload, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const body = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = lib.request({
      method: payload ? 'POST' : 'GET',
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      timeout,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {},
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(text || `HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(text || '{}')); }
        catch (err) { reject(new Error(`Ollama 返回不是 JSON：${err.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求 Ollama 超时')));
    if (body) req.write(body);
    req.end();
  });
}

ipcMain.handle('shell:openExternal', async (_event, url) => {
  const allowed = new Set(['https://ollama.com', 'https://cangify.com']);
  if (!allowed.has(String(url))) throw new Error('不允许打开的链接');
  await shell.openExternal(url);
  return true;
});
