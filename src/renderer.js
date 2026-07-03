const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  videos: [],
  processing: false,
  segments: defaultSegments(),
};

const pageMeta = {
  videos: ['视频任务', '添加视频，按你的命名规则自动生成新文件名。'],
  rules: ['命名模板', '像搭积木一样组合标题、分类、标签或任意自定义片段。'],
  model: ['模型设置', '连接 Ollama、选择视觉模型、设置截图数量和超时。'],
  logs: ['运行日志', '查看生成、重试、错误与重命名记录。'],
  about: ['关于软件', '了解软件用途、工作方式和官方网站。'],
};

function defaultSegments() {
  return [
    {
      id: crypto.randomUUID(), enabled: true, name: '标题', prefix: 'T=', joinBefore: false, connector: '',
      rule: '根据截图生成一个中文视频标题。只输出标题本身，6到16个中文字符，要自然、有画面感、适合做文件名。不要解释，不要标点，不要数字，不要引号，不要扩展名。',
    },
    {
      id: crypto.randomUUID(), enabled: true, name: '分类', prefix: 'C=', joinBefore: true, connector: '__',
      rule: '根据截图生成分类。只输出分类词，多个分类用英文逗号分隔。分类要概括人物身材、年龄感、人数类型。不要解释，不要标点句子，不要扩展名。',
    },
    {
      id: crypto.randomUUID(), enabled: true, name: '标签', prefix: 'G=', joinBefore: true, connector: '__',
      rule: '根据截图生成标签。只输出标签词，多个标签用英文逗号分隔。标签可以包含画面主体、人物特征、场景、着装等。不要解释，不要扩展名。',
    },
  ];
}

function normalizeSegmentName(name, index) {
  const fallback = ['标题', '分类', '标签'][index] || `自定义片段${index + 1}`;
  return String(name || fallback).replace(/^名称\s*(\d+)$/i, (_, n) => ['标题', '分类', '标签'][Number(n) - 1] || `自定义片段${n}`);
}

function init() {
  bindNav();
  bindButtons();
  renderSegments();
  renderVideos();
  loadSettings();
  log('软件已启动。Ai 视频自动命名工具已就绪。');
}

function bindNav() {
  $$('.nav').forEach((btn) => btn.addEventListener('click', () => showPage(btn.dataset.page)));
}

function showPage(page) {
  $$('.nav').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === page));
  $('#pageTitle').textContent = pageMeta[page][0];
  $('#pageSubtitle').textContent = pageMeta[page][1];
}

function bindButtons() {
  $('#addVideosBtn').addEventListener('click', async () => addPaths(await window.aglove.pickVideos()));
  $('#addFolderBtn').addEventListener('click', async () => addPaths(await window.aglove.pickFolder()));
  $('#removeSelectedBtn').addEventListener('click', removeSelected);
  $('#clearBtn').addEventListener('click', () => { state.videos = []; renderVideos(); });
  $('#addSegmentBtn').addEventListener('click', addSegment);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#startBtn').addEventListener('click', startProcessing);
  $('#loadModelsBtn').addEventListener('click', loadModels);
  $('#ollamaSiteBtn')?.addEventListener('click', () => window.aglove.openExternal('https://ollama.com'));
  $('#cangifySiteBtn')?.addEventListener('click', () => window.aglove.openExternal('https://cangify.com'));
}

async function loadSettings() {
  const data = await window.aglove.loadSettings();
  if (!data) return;
  $('#ollamaUrl').value = data.ollamaUrl || 'http://127.0.0.1:11434';
  $('#modelName').value = data.modelName || 'llava';
  $('#shotCount').value = data.shotCount || 5;
  $('#timeoutSec').value = data.timeoutSec || 900;
  $('#autoRename').checked = !!data.autoRename;
  if (Array.isArray(data.segments) && data.segments.length) {
    state.segments = data.segments.map((s, i) => ({ ...s, id: s.id || crypto.randomUUID(), name: normalizeSegmentName(s.name, i) }));
    renderSegments();
  }
  log('已读取设置。');
}

async function saveSettings() {
  syncSegmentsFromDom();
  const savedTo = await window.aglove.saveSettings(getSettings());
  log(`设置已保存：${savedTo}`);
}

function getSettings() {
  return {
    ollamaUrl: $('#ollamaUrl').value.trim(),
    modelName: $('#modelName').value.trim(),
    shotCount: Number($('#shotCount').value || 5),
    timeoutSec: Number($('#timeoutSec').value || 900),
    autoRename: $('#autoRename').checked,
    segments: state.segments,
  };
}

async function loadModels() {
  try {
    const models = await window.aglove.ollamaTags({ baseUrl: $('#ollamaUrl').value.trim() });
    if (models.length) {
      $('#modelName').value = models[0];
      log(`已加载模型：${models.join(', ')}`);
    } else log('Ollama 没有返回模型列表。');
  } catch (err) {
    log(`加载模型失败：${err.message}`);
  }
}

function addPaths(paths) {
  const existing = new Set(state.videos.map((v) => v.path));
  let added = 0;
  for (const p of paths || []) {
    if (existing.has(p)) continue;
    state.videos.push({ id: crypto.randomUUID(), path: p, selected: true, status: '等待处理', newName: '' });
    existing.add(p); added += 1;
  }
  renderVideos();
  log(`已添加 ${added} 个视频。`);
}

function renderVideos() {
  $('#countBadge').textContent = `${state.videos.length} 个视频`;
  const tbody = $('#videoRows');
  tbody.innerHTML = '';
  state.videos.forEach((v) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="sel"><input type="checkbox" ${v.selected ? 'checked' : ''} data-id="${v.id}" /></td>
      <td title="${escapeHtml(v.path)}">${escapeHtml(v.path)}</td>
      <td class="status">${escapeHtml(v.status)}</td>
      <td class="new-name">${escapeHtml(v.newName || '')}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', () => {
    const item = state.videos.find((v) => v.id === cb.dataset.id);
    if (item) item.selected = cb.checked;
  }));
}

function removeSelected() {
  state.videos = state.videos.filter((v) => !v.selected);
  renderVideos();
}

function addSegment() {
  syncSegmentsFromDom();
  const n = state.segments.length + 1;
  state.segments.push({
    id: crypto.randomUUID(), enabled: true, name: `自定义片段${n}`, prefix: '', joinBefore: true, connector: '__',
    rule: '写清楚这一段要生成什么。要求模型只输出这一段的最终内容，不要解释，不要扩展名。',
  });
  renderSegments();
}

function renderSegments() {
  const wrap = $('#segments');
  wrap.innerHTML = '';
  state.segments.forEach((seg, index) => {
    const card = document.createElement('div');
    card.className = 'card segment';
    card.dataset.id = seg.id;
    card.innerHTML = `
      <div class="segment-head">
        <div class="segment-kicker">片段 ${String(index + 1).padStart(2, '0')}</div>
        <div class="segment-title">${escapeHtml(normalizeSegmentName(seg.name, index))}</div>
        <div class="segment-tools">
          <button class="icon-btn move-up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-btn move-down" title="下移" ${index === state.segments.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-btn danger delete-seg" title="删除" ${state.segments.length <= 1 ? 'disabled' : ''}>×</button>
        </div>
      </div>
      <div class="segment-grid">
        <label>片段名称<input class="seg-name" value="${escapeAttr(normalizeSegmentName(seg.name, index))}" placeholder="例如：标题 / 分类 / 标签" /></label>
        <label>固定前缀<input class="seg-prefix" value="${escapeAttr(seg.prefix || '')}" placeholder="可空，如 T=" /></label>
      </div>
      <div class="connect-row">
        <label class="switch-line"><input class="seg-enabled" type="checkbox" ${seg.enabled ? 'checked' : ''} /> 使用这个片段</label>
        <label class="switch-line"><input class="seg-join" type="checkbox" ${seg.joinBefore ? 'checked' : ''} ${index === 0 && state.segments.length > 1 ? 'disabled' : ''} /> 与前一片段连接</label>
        <label class="connector-field">连接符<input class="seg-connector" type="text" value="${escapeAttr(seg.connector || '')}" placeholder="__" ${index === 0 && state.segments.length > 1 ? 'disabled' : ''} /></label>
      </div>
      <label>生成规则<textarea class="seg-rule">${escapeHtml(seg.rule || '')}</textarea></label>`;
    wrap.appendChild(card);
  });

  wrap.querySelectorAll('input, textarea').forEach((el) => el.addEventListener('input', () => { syncSegmentsFromDom(); updatePatternPreview(); }));
  wrap.querySelectorAll('.move-up').forEach((btn) => btn.addEventListener('click', () => moveSegment(btn.closest('.segment').dataset.id, -1)));
  wrap.querySelectorAll('.move-down').forEach((btn) => btn.addEventListener('click', () => moveSegment(btn.closest('.segment').dataset.id, 1)));
  wrap.querySelectorAll('.delete-seg').forEach((btn) => btn.addEventListener('click', () => deleteSegment(btn.closest('.segment').dataset.id)));
  updatePatternPreview();
}

function syncSegmentsFromDom() {
  const cards = $$('.segment');
  if (!cards.length) return;
  state.segments = cards.map((card, i) => ({
    id: card.dataset.id,
    enabled: card.querySelector('.seg-enabled').checked,
    name: card.querySelector('.seg-name').value.trim() || `自定义片段${i + 1}`,
    prefix: card.querySelector('.seg-prefix').value,
    joinBefore: i === 0 && cards.length > 1 ? false : card.querySelector('.seg-join').checked,
    connector: i === 0 && cards.length > 1 ? '' : card.querySelector('.seg-connector').value,
    rule: card.querySelector('.seg-rule').value.trim(),
  }));
}

function moveSegment(id, dir) {
  syncSegmentsFromDom();
  const i = state.segments.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.segments.length) return;
  [state.segments[i], state.segments[j]] = [state.segments[j], state.segments[i]];
  renderSegments();
}

function deleteSegment(id) {
  syncSegmentsFromDom();
  state.segments = state.segments.filter((s) => s.id !== id);
  renderSegments();
}

function updatePatternPreview() {
  const parts = [];
  for (const seg of state.segments.filter((s) => s.enabled)) {
    const token = `${seg.prefix || ''}${seg.name || '片段'}`;
    if (!parts.length) parts.push(token);
    else parts.push(`${seg.joinBefore ? (seg.connector || '') : ''}${token}`);
  }
  $('#patternPreview').textContent = parts.join('') || '未启用任何名称段';
}

async function startProcessing() {
  if (state.processing) return;
  syncSegmentsFromDom();
  const settings = getSettings();
  const targets = state.videos.filter((v) => v.selected);
  if (!targets.length) return log('请先选择要处理的视频。');
  if (!settings.segments.some((s) => s.enabled && s.rule.trim())) return log('请至少启用一个有规则的名称段。');

  state.processing = true;
  $('#startBtn').disabled = true;
  try {
    for (const item of targets) {
      await processOne(item, settings);
      renderVideos();
    }
  } finally {
    state.processing = false;
    $('#startBtn').disabled = false;
    log('处理完成。');
  }
}

async function processOne(item, settings) {
  try {
    item.status = '截图中'; renderVideos();
    log(`开始处理：${baseName(item.path)}`);
    const images = await captureScreenshots(item.path, settings.shotCount);
    log(`已截图 ${images.length} 张：${baseName(item.path)}`);

    const outputs = [];
    for (const seg of settings.segments.filter((s) => s.enabled)) {
      item.status = `${seg.name} 生成中`; renderVideos();
      const value = await generateSegment(seg, item.path, images, settings);
      outputs.push({ seg, value });
      log(`${seg.name}：${value}`);
    }

    const finalName = combineOutputs(outputs);
    item.newName = finalName;
    item.status = '已生成';
    log(`生成名称：${baseName(item.path)} -> ${finalName}`);

    if (settings.autoRename) {
      const newPath = await window.aglove.renameFile({ filePath: item.path, newBaseName: finalName });
      item.path = newPath;
      item.status = '已重命名';
      log(`已重命名：${newPath}`);
    }
  } catch (err) {
    item.status = '失败';
    log(`失败：${baseName(item.path)}，原因：${err.message}`);
  }
}

async function generateSegment(seg, filePath, images, settings) {
  let lastRaw = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt = buildPrompt(seg, filePath, lastRaw, attempt);
    const raw = await window.aglove.ollamaGenerate({
      baseUrl: settings.ollamaUrl,
      model: settings.modelName,
      prompt,
      images,
      timeout: Math.max(60, settings.timeoutSec) * 1000,
    });
    lastRaw = raw;
    const cleaned = cleanSegmentOutput(raw, seg);
    const check = validateSegment(cleaned, seg);
    if (check.ok) return cleaned;
    log(`${seg.name} 输出违规，自动重试 ${attempt}/3：${check.reason}；原始返回：${raw.slice(0, 140)}`);
  }
  throw new Error(`${seg.name} 连续 3 次不符合规则，已拒绝采用。最后返回：${lastRaw.slice(0, 180)}`);
}

function buildPrompt(seg, filePath, lastRaw, attempt) {
  const retry = attempt > 1 ? `\n\n上一轮输出违规，不要重复。上一轮内容：${lastRaw.slice(0, 180)}\n现在重新输出，必须只输出纯内容。` : '';
  return `你是视频文件命名助手。图片来自同一个视频。\n\n当前只生成这一段：${seg.name}\n输出前缀：${seg.prefix || '无'}\n原文件名：${baseName(filePath)}\n\n这一段的命名规则：\n${seg.rule}\n\n硬性规则：\n1. 只输出${seg.name}的最终内容本身。\n2. 不要解释，不要分析过程，不要复述规则。\n3. 不要输出“需要再加”“多少字”“标题为”“文件名”等说明。\n4. 不要输出扩展名。\n5. 如果需要多个词，只能按用户规则使用英文逗号。\n${retry}`;
}

function cleanSegmentOutput(raw, seg) {
  let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```/g, '').trim();
  text = text.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).pop() || text;
  text = text.replace(/^\s*(?:T|C|G|标题|名称|文件名|分类|标签|结果|输出)\s*[:：=]\s*/i, '');
  const quoted = [...text.matchAll(/[“‘"']([^”’"']{2,})[”’"']/g)].map((m) => m[1]);
  if (quoted.length) text = quoted[quoted.length - 1];
  text = text.replace(/\s*(?:->|→|⇒|➡).*?(?:\d+\s*(?:个?字|字符)|字数).*$/g, '');
  text = text.replace(/[（(【\[]\s*\d+\s*(?:个?字|字符)\s*[）)】\]]\s*$/g, '');
  text = text.replace(/(?:是|为|标题|文件名)$/g, '');
  text = text.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '');
  if (seg.prefix === 'C=' || seg.prefix === 'G=' || /分类|标签/.test(seg.name)) {
    text = text.replace(/[，、；;\s]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
  } else {
    text = text.replace(/[，。、《》？！；：‘’“”"'`·•…—–~～,.;:!?()（）\[\]【】{}]/g, '').replace(/\s+/g, '');
  }
  return text.trim().slice(0, 80);
}

function validateSegment(text, seg) {
  if (!text) return { ok: false, reason: '内容为空' };
  const forbidden = ['用户', '要求', '规则', '提示词', '需要', '再加', '字数', '个字', '字符', '输出', '解释', '截图', '图片', '首先', '分析', '应该', '可以', '符合', '格式', '文件名', '标题为'];
  const hit = forbidden.find((w) => text.includes(w));
  if (hit) return { ok: false, reason: `包含说明词：${hit}` };
  if (/[→⇒➡]/.test(text)) return { ok: false, reason: '包含箭头说明' };
  if (/\d+\s*(个?字|字符)/.test(text)) return { ok: false, reason: '包含字数说明' };
  if (seg.prefix !== 'C=' && seg.prefix !== 'G=' && !/分类|标签/.test(seg.name)) {
    if (/\d/.test(text)) return { ok: false, reason: '标题包含数字' };
    if (/[，。、《》？！；：‘’“”"'`·•…—–~～,.;:!?()（）\[\]【】{}]/.test(text)) return { ok: false, reason: '标题包含标点' };
  }
  return { ok: true };
}

function combineOutputs(outputs) {
  let final = '';
  outputs.forEach(({ seg, value }, i) => {
    const part = `${seg.prefix || ''}${value}`;
    final += i === 0 ? part : `${seg.joinBefore ? (seg.connector || '') : ''}${part}`;
  });
  return sanitizeFileName(final).slice(0, 180);
}

function sanitizeFileName(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '').replace(/\s+/g, '').replace(/^\.+|\.+$/g, '') || '未命名视频';
}

async function captureScreenshots(filePath, count) {
  const video = $('#captureVideo');
  const canvas = $('#captureCanvas');
  const url = pathToFileUrl(filePath);
  video.removeAttribute('src');
  video.src = url;
  await once(video, 'loadedmetadata', 30000);
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const width = video.videoWidth || 960;
  const height = video.videoHeight || 540;
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  const n = Math.max(1, Math.min(12, Number(count || 5)));
  const times = n === 1 ? [duration / 2] : Array.from({ length: n }, (_, i) => duration * (0.12 + (0.76 * i) / (n - 1)));
  const images = [];
  for (const t of times) {
    video.currentTime = Math.min(duration - 0.05, Math.max(0, t));
    await once(video, 'seeked', 15000);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    images.push(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
  }
  video.removeAttribute('src');
  return images;
}

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => cleanup(() => reject(new Error(`等待 ${event} 超时`))), timeoutMs);
    const onEvent = () => cleanup(resolve);
    const onError = () => cleanup(() => reject(new Error('视频加载/解码失败')));
    function cleanup(done) {
      clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      done();
    }
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

function pathToFileUrl(p) {
  let path = String(p).replace(/\\/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  return encodeURI(`file://${path}`);
}

function baseName(p) {
  return String(p).split(/[\\/]/).pop();
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  $('#logText').textContent += `${line}\n`;
  $('#logText').scrollTop = $('#logText').scrollHeight;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

init();
