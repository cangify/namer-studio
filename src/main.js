const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const os = require('os');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.webm', '.m4v', '.ts']);
const SIDEBAR_AD_URL = 'https://cangify.com/globle/ads/namer-studio/namer-studio.json';
const UPDATE_FEED_URL = 'https://cangify.com/globle/update/namer-studio.json';
const DEFAULT_AD_REFRESH_SECONDS = 300;

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

ipcMain.handle('template:importFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '导入命名模板',
    properties: ['openFile'],
    filters: [{ name: '命名模板 JSON', extensions: ['json'] }, { name: '所有文件', extensions: ['*'] }],
  });
  if (canceled || !filePaths[0]) return null;
  const filePath = filePaths[0];
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  return { filePath, data };
});

ipcMain.handle('template:exportFile', async (_event, payload) => {
  const rawName = sanitizeFileName(payload?.template?.name || '命名模板') || '命名模板';
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '导出命名模板',
    defaultPath: `${rawName}.json`,
    filters: [{ name: '命名模板 JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
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

ipcMain.handle('file:trash', async (_event, paths) => {
  const trashed = [];
  for (const p of paths || []) {
    if (!p || !fsSync.existsSync(p)) continue;
    await shell.trashItem(p);
    trashed.push(p);
  }
  return trashed;
});

ipcMain.handle('file:open', async (_event, filePath) => {
  if (!filePath || !fsSync.existsSync(filePath)) throw new Error('文件不存在');
  const error = await shell.openPath(filePath);
  if (error) throw new Error(error);
  return true;
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
  try {
    await fs.rename(filePath, target);
  } catch (err) {
    if (err?.code === 'ENAMETOOLONG' || err?.code === 'EINVAL') {
      throw new Error('文件名或路径太长，系统拒绝重命名。请在模板里减少标题、分类或标签数量后重试。');
    }
    throw err;
  }
  return target;
});

ipcMain.handle('screenshots:save', async (_event, { filePath, images }) => {
  const list = Array.isArray(images) ? images : [];
  const parsed = path.parse(filePath);
  const videoName = sanitizeFileName(parsed.name) || '未命名视频';
  const targetDir = path.join(parsed.dir, '截图', videoName);
  await fs.mkdir(targetDir, { recursive: true });
  const saved = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = String(list[i] || '').replace(/^data:image\/\w+;base64,/, '');
    if (!raw) continue;
    const target = path.join(targetDir, `${String(i + 1).padStart(2, '0')}.jpg`);
    await fs.writeFile(target, Buffer.from(raw, 'base64'));
    saved.push(target);
  }
  return { dir: targetDir, files: saved };
});

ipcMain.handle('screenshots:captureFfmpeg', async (_event, { filePath, count }) => captureScreenshotsWithFfmpeg(filePath, count));

async function captureScreenshotsWithFfmpeg(filePath, count) {
  if (!filePath || !fsSync.existsSync(filePath)) throw new Error('视频文件不存在');
  const ffmpeg = getBundledToolPath('ffmpeg-static-electron');
  const ffprobe = getBundledToolPath('ffprobe-static-electron');
  if (!ffmpeg || !ffprobe) throw new Error('缺少 FFmpeg 组件，无法解析该视频格式');
  const duration = await probeVideoDuration(ffprobe, filePath);
  const n = Math.max(1, Math.min(12, Number(count || 5)));
  const times = n === 1 ? [duration / 2] : Array.from({ length: n }, (_, i) => duration * (0.12 + (0.76 * i) / (n - 1)));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aglove-shots-'));
  const images = [];
  try {
    for (let i = 0; i < times.length; i += 1) {
      const target = path.join(tempDir, `${String(i + 1).padStart(2, '0')}.jpg`);
      await runExecFile(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', String(Math.max(0, times[i])),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', "scale='min(768,iw)':-2",
        '-q:v', '3',
        target,
      ], 60000);
      images.push((await fs.readFile(target)).toString('base64'));
    }
    return images;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getBundledToolPath(moduleName) {
  try {
    const mod = require(moduleName);
    const raw = mod.path || mod;
    if (!raw) return '';
    return String(raw).replace('app.asar', 'app.asar.unpacked');
  } catch (_) {
    return '';
  }
}

async function probeVideoDuration(ffprobe, filePath) {
  const { stdout } = await runExecFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], 30000);
  const duration = Number(String(stdout || '').trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取视频时长');
  return duration;
}

function runExecFile(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        error.message = String(stderr || error.message || '').trim() || error.message;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

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
  const payload = {
    model,
    prompt,
    images,
    stream: true,
    options: {
      temperature: 0.1,
      num_ctx: 16384,
      num_predict: 4096,
    },
  };

  const streamed = await requestOllamaStream(`${cleanBase}/api/generate`, payload, timeout);
  if (streamed) return streamed;

  const chatPayload = {
    model,
    stream: false,
    messages: [{ role: 'user', content: prompt, images }],
    options: {
      temperature: 0.1,
      num_ctx: 16384,
      num_predict: 4096,
    },
  };
  const chat = await requestJson(`${cleanBase}/api/chat`, chatPayload, timeout);
  const chatText = cleanModelText(chat.message?.content || chat.response || chat.thinking || '');
  if (chatText) return chatText;

  const reason = chat.done_reason || chat.error || '';
  throw new Error(`Ollama 没有返回内容${reason ? `（${reason}）` : ''}。请确认当前模型支持图片/视觉输入，建议选择 qwen3-vl 或其他视觉模型。`);
});

ipcMain.handle('ads:getSidebarAd', async () => {
  try {
    const data = await requestJson(withCacheBuster(SIDEBAR_AD_URL, '_ad_json_v'), null, 10000);
    return normalizeSidebarAd(data);
  } catch (err) {
    return {
      enabled: false,
      intervalSeconds: 5,
      refreshSeconds: DEFAULT_AD_REFRESH_SECONDS,
      version: '',
      updatedAt: '',
      ads: [],
      error: err.message,
    };
  }
});

ipcMain.handle('update:check', async () => checkUpdate());

function cleanModelText(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/[\x00-\x1f\x7f]+/g, '\n')
    .trim();
}

function requestOllamaStream(urlString, payload, timeout) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const body = Buffer.from(JSON.stringify(payload));
    const req = lib.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let buffer = '';
      const responseParts = [];
      const thinkingParts = [];
      let errorText = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (res.statusCode >= 400) { errorText += chunk; return; }
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.response) responseParts.push(data.response);
            if (data.thinking) thinkingParts.push(data.thinking);
          } catch (_) {}
        }
      });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(errorText || `HTTP ${res.statusCode}`));
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            if (data.response) responseParts.push(data.response);
            if (data.thinking) thinkingParts.push(data.thinking);
          } catch (_) {}
        }
        const response = cleanModelText(responseParts.join(''));
        if (response) return resolve(response);
        resolve(cleanModelText(thinkingParts.join('')));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('请求 Ollama 超时')));
    req.write(body);
    req.end();
  });
}

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

async function checkUpdate() {
  const currentVersion = app.getVersion();
  const data = await requestJson(withCacheBuster(UPDATE_FEED_URL, '_update_json_v'), null, 10000);
  const latestVersion = String(data?.latest_version || data?.version || data?.latestVersion || '').replace(/^v/i, '').trim();
  const downloadUrl = normalizeDownloadUrl(data?.download_url || data?.windows_download_url || data?.url || data?.homepage || '');
  const releaseDate = String(data?.release_date || data?.releaseDate || '').trim();
  const notes = Array.isArray(data?.notes) ? data.notes.map((n) => String(n).trim()).filter(Boolean).slice(0, 20) : [];
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;
  return {
    hasUpdate,
    currentVersion,
    latestVersion: latestVersion || currentVersion,
    releaseDate,
    mandatory: !!data?.mandatory,
    downloadUrl,
    homepage: normalizeDownloadUrl(data?.homepage || 'https://cangify.com'),
    notes,
  };
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  const len = Math.max(left.length, right.length, 1);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(value) {
  return String(value || '0')
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => Number(n) || 0);
}

function normalizeDownloadUrl(value) {
  return normalizeAdUrl(value, false, '');
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 120);
}

function normalizeSidebarAd(data) {
  const version = String(data?.updatedAt || data?.version || '').trim();
  const ads = Array.isArray(data?.ads) ? data.ads.map((ad) => normalizeAdItem(ad, version)).filter(Boolean) : [];
  return {
    enabled: data?.enabled !== false && ads.length > 0,
    intervalSeconds: clampNumber(data?.intervalSeconds, 3, 3600, 5),
    refreshSeconds: clampNumber(data?.refreshSeconds, 30, 86400, DEFAULT_AD_REFRESH_SECONDS),
    updatedAt: String(data?.updatedAt || ''),
    version: String(data?.version || version || ''),
    ads,
  };
}

function normalizeAdItem(ad, version) {
  const imageUrl = normalizeAdUrl(ad?.imageUrl, true, version);
  const linkUrl = normalizeAdUrl(ad?.linkUrl, false, '');
  if (!imageUrl || !linkUrl) return null;
  return {
    title: String(ad?.title || '').slice(0, 80),
    alt: String(ad?.alt || ad?.title || '广告').slice(0, 120),
    imageUrl,
    linkUrl,
  };
}

function normalizeAdUrl(value, addVersion, version) {
  try {
    let raw = String(value || '').trim();
    if (!raw) return '';
    if (/^www\./i.test(raw) || /^[a-z0-9.-]+\//i.test(raw)) raw = `https://${raw}`;
    const target = new URL(raw);
    if (!['https:', 'http:'].includes(target.protocol)) return '';
    if (addVersion && version) target.searchParams.set('_fo_ad_v', version);
    return target.toString();
  } catch (_) {
    return '';
  }
}

function withCacheBuster(urlString, key) {
  const target = new URL(urlString);
  target.searchParams.set(key, String(Date.now()));
  return target.toString();
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

ipcMain.handle('shell:openExternal', async (_event, url) => {
  const target = new URL(String(url));
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('不允许打开的链接');
  await shell.openExternal(target.toString());
  return true;
});
