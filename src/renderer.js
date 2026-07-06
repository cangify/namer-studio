const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  videos: [],
  videoSearch: '',
  videoStatusFilter: 'all',
  processing: false,
  paused: false,
  timer: null,
  modelList: [],
  segments: defaultSegments(),
  sidebarAd: null,
  sidebarAdIndex: 0,
  sidebarAdRotateTimer: null,
  sidebarAdRefreshTimer: null,
  updateInfo: null,
};

const pageMeta = {
  videos: ['视频任务', '添加视频，按你的命名规则自动生成新文件名。'],
  rules: ['命名模板', '设置标题段、前缀、后缀和生成规则。'],
  model: ['模型设置', '连接 Ollama、选择视觉模型、设置截图数量和超时。'],
  logs: ['运行日志', '查看生成、重试、错误与重命名记录。'],
  about: ['关于软件', '了解软件用途、工作方式和官方网站。'],
};

function defaultSegments() {
  return [
    {
      id: crypto.randomUUID(), enabled: true, name: '标题01', prefix: 'T=', joinBefore: false, suffix: '__', connector: '__',
      rule: '根据截图生成一个中文视频标题。只输出标题本身，6到16个中文字符，要自然、有画面感、适合做文件名。不要解释，不要标点，不要数字，不要引号，不要扩展名。',
    },
    {
      id: crypto.randomUUID(), enabled: true, name: '标题02', prefix: '', joinBefore: true, suffix: '__', connector: '__',
      rule: '根据截图生成第二段中文标题，可补充人物特征、画面重点或风格。只输出标题内容本身，4到14个中文字符。不要解释，不要标点，不要数字，不要引号，不要扩展名。',
    },
    {
      id: crypto.randomUUID(), enabled: true, name: '标题03', prefix: '', joinBefore: true, suffix: '', connector: '',
      rule: '根据截图生成第三段中文标题，可补充场景或动作。只输出标题内容本身，4到14个中文字符。不要解释，不要标点，不要数字，不要引号，不要扩展名。',
    },
  ];
}

function normalizeSegmentName(name, index) {
  const fallback = `标题${String(index + 1).padStart(2, '0')}`;
  return String(name || fallback)
    .replace(/^名称\s*(\d+)$/i, (_, n) => `标题${String(n).padStart(2, '0')}`)
    .replace(/^自定义片段\s*(\d+)$/i, (_, n) => `标题${String(n).padStart(2, '0')}`)
    .replace(/^标题(\d+)$/i, (_, n) => `标题${String(n).padStart(2, '0')}`);
}

function init() {
  bindButtonFeedback();
  bindNav();
  bindButtons();
  bindDropImportBridge();
  bindDropImport();
  bindColumnResize();
  checkOllamaInstall();
  renderSegments();
  renderVideos();
  loadSettings();
  loadSidebarAd();
  setTimeout(() => checkSoftwareUpdate({ silent: true }), 1200);
  log('软件已启动。Ai 视频自动命名工具已就绪。');
}

function bindButtonFeedback() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    button.classList.remove('tap-feedback');
    void button.offsetWidth;
    button.classList.add('tap-feedback');
    const text = buttonFeedbackText(button);
    if (text) showToast(text);
  }, true);
}

function buttonFeedbackText(button) {
  if (button.classList.contains('nav')) return `已切换到${button.textContent.trim()}`;
  const id = button.id;
  const map = {
    saveSettingsBtn: '正在保存设置…',
    startBtn: '开始处理视频…',
    renameGeneratedBtn: '正在修改已生成名称…',
    reanalyzeSelectedBtn: '重新分析选中视频…',
    retryFailedBtn: '重试失败或未命名视频…',
    moreActionsBtn: '更多操作',
    pauseBtn: '已请求暂停',
    resumeBtn: '继续处理',
    toggleSelectAllBtn: '切换全选状态',
    selectFailedBtn: '已选择失败/未命名',
    deleteSelectedFilesBtn: '准备删除选中文件',
    addVideosBtn: '请选择视频文件',
    addFolderBtn: '请选择视频文件夹',
    removeSelectedBtn: '已收到移除选中操作',
    clearBtn: '已清空列表',
    clearVideoFiltersBtn: '已清除筛选',
    addSegmentBtn: '已添加标题段',
    loadModelsBtn: '正在加载 Ollama 模型…',
    checkUpdateBtn: '正在检查软件更新…',
    aboutCheckUpdateBtn: '正在检查软件更新…',
    cangifySiteBtn: '正在打开官网…',
    ollamaNoticeBtn: '正在打开 Ollama 官网…',
  };
  if (map[id]) return map[id];
  if (button.classList.contains('move-up')) return '已上移标题段';
  if (button.classList.contains('move-down')) return '已下移标题段';
  if (button.classList.contains('delete-seg')) return '已删除标题段';
  return button.textContent.trim() ? `已点击：${button.textContent.trim()}` : '操作已响应';
}

let toastTimer = null;
function showToast(message) {
  const toast = $('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
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
  $('#deleteSelectedFilesBtn').addEventListener('click', deleteSelectedFiles);
  $('#clearBtn').addEventListener('click', () => { closeMoreActions(); state.videos = []; renderVideos(); showToast('列表已清空'); });
  $('#videoSearchInput')?.addEventListener('input', (event) => { state.videoSearch = event.target.value.trim(); renderVideos(); });
  $('#videoStatusFilter')?.addEventListener('change', (event) => { state.videoStatusFilter = event.target.value; renderVideos(); });
  $('#clearVideoFiltersBtn')?.addEventListener('click', clearVideoFilters);
  $('#toggleSelectAllBtn').addEventListener('click', toggleSelectAll);
  $('#selectFailedBtn').addEventListener('click', selectFailedOrUnnamed);
  $('#addSegmentBtn').addEventListener('click', addSegment);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#startBtn').addEventListener('click', () => startProcessing({ targets: state.videos.filter((v) => v.selected) }));
  $('#renameGeneratedBtn').addEventListener('click', renameGeneratedFiles);
  $('#reanalyzeSelectedBtn').addEventListener('click', reanalyzeSelected);
  $('#retryFailedBtn').addEventListener('click', retryFailedOrUnnamed);
  $('#pauseBtn').addEventListener('click', pauseProcessing);
  $('#resumeBtn').addEventListener('click', resumeProcessing);
  $('#loadModelsBtn').addEventListener('click', loadModels);
  $('#checkUpdateBtn')?.addEventListener('click', () => checkSoftwareUpdate({ silent: false }));
  $('#aboutCheckUpdateBtn')?.addEventListener('click', () => checkSoftwareUpdate({ silent: false }));
  $('#downloadUpdateBtn')?.addEventListener('click', downloadUpdate);
  $('#copyUpdateLinkBtn')?.addEventListener('click', copyUpdateLink);
  $('#closeUpdateDialogBtn')?.addEventListener('click', closeUpdateDialog);
  $('#updateDialog')?.addEventListener('click', (event) => { if (event.target.id === 'updateDialog') closeUpdateDialog(); });
  $('#moreActionsBtn').addEventListener('click', toggleMoreActions);
  document.addEventListener('click', closeMoreActionsOnOutside);
  $('#cangifySiteBtn')?.addEventListener('click', () => window.aglove.openExternal('https://cangify.com'));
  $('#sidebarAd')?.addEventListener('click', openCurrentSidebarAd);
  $('#sidebarAd')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCurrentSidebarAd();
    }
  });
}

function toggleMoreActions(event) {
  event?.stopPropagation();
  const menu = $('#moreActionsMenu');
  if (!menu) return;
  menu.hidden = !menu.hidden;
}

function closeMoreActionsOnOutside(event) {
  const menu = $('#moreActionsMenu');
  const wrap = $('.more-actions');
  if (!menu || menu.hidden || wrap?.contains(event.target)) return;
  menu.hidden = true;
}

function closeMoreActions() {
  const menu = $('#moreActionsMenu');
  if (menu) menu.hidden = true;
}

function setModelOptions(models, selected) {
  const select = $('#modelName');
  const current = selected || select.value || 'llava';
  const unique = [...new Set([...(models || []), current].filter(Boolean))];
  state.modelList = unique;
  select.innerHTML = unique.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
  select.value = unique.includes(current) ? current : (unique[0] || 'llava');
}

function setOllamaNotice(type, html) {
  const notice = $('#ollamaInstallNotice');
  if (!notice) return;
  notice.hidden = false;
  notice.className = `ollama-notice ${type || ''}`.trim();
  notice.innerHTML = html;
}

function bindDropImportBridge() {
  window.addEventListener('message', async (event) => {
    const data = event.data;
    if (!data || data.type !== 'aglove:dropped-paths' || !Array.isArray(data.paths)) return;
    await importDroppedPaths(data.paths);
  });
}

async function importDroppedPaths(rawPaths) {
  if (!rawPaths.length) return showToast('没有识别到可导入的视频');
  try {
    const paths = await window.aglove.resolveDropped(rawPaths);
    addPaths(paths);
    showToast(paths.length ? `已拖入 ${paths.length} 个视频` : '没有找到可导入的视频');
  } catch (err) {
    showToast('拖拽导入失败');
    log(`拖拽导入失败：${err.message}`);
  }
}

function bindDropImport() {
  const shell = $('.app-shell');
  if (!shell) return;
  let dragDepth = 0;
  shell.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    shell.classList.add('drag-over');
  });
  shell.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  shell.addEventListener('dragleave', (event) => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) shell.classList.remove('drag-over');
  });
  shell.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    shell.classList.remove('drag-over');
    let rawPaths = [];
    try { rawPaths = window.aglove.droppedFilePaths(event.dataTransfer.files); } catch (_) {}
    if (rawPaths.length) await importDroppedPaths(rawPaths);
    else showToast('正在读取拖拽文件路径…');
  });
}

async function checkSoftwareUpdate({ silent = false } = {}) {
  const buttons = ['#checkUpdateBtn', '#aboutCheckUpdateBtn'].map((sel) => $(sel)).filter(Boolean);
  if (!silent) buttons.forEach((button) => { button.disabled = true; });
  try {
    const info = await window.aglove.checkUpdate();
    state.updateInfo = info;
    if (info?.hasUpdate) {
      showUpdateDialog(info);
      log(`发现新版本：${info.latestVersion}（当前 ${info.currentVersion}）。`);
    } else {
      log(`软件已是最新版本：${info?.currentVersion || ''}`);
      if (!silent) showToast('当前已是最新版本');
    }
  } catch (err) {
    log(`检查更新失败：${err.message}`);
    if (!silent) showToast(`检查更新失败：${err.message}`);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function showUpdateDialog(info) {
  const dialog = $('#updateDialog');
  const body = $('#updateDialogBody');
  if (!dialog || !body) return;
  const notes = Array.isArray(info.notes) && info.notes.length
    ? `<ul>${info.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`
    : '<p class="muted-line">暂无更新说明。</p>';
  body.innerHTML = `
    <div class="update-version-line">
      <span>当前版本：<b>${escapeHtml(info.currentVersion || '')}</b></span>
      <span>最新版本：<b>${escapeHtml(info.latestVersion || '')}</b></span>
    </div>
    ${info.releaseDate ? `<div class="muted-line">发布日期：${escapeHtml(info.releaseDate)}</div>` : ''}
    ${info.mandatory ? '<div class="update-required">这是一个重要更新，建议尽快下载。</div>' : ''}
    <div class="update-notes"><b>更新说明</b>${notes}</div>
    <div class="update-url">${escapeHtml(info.downloadUrl || info.homepage || '')}</div>`;
  dialog.hidden = false;
}

function closeUpdateDialog() {
  const dialog = $('#updateDialog');
  if (dialog) dialog.hidden = true;
}

function downloadUpdate() {
  const url = state.updateInfo?.downloadUrl || state.updateInfo?.homepage;
  if (!url) return showToast('没有可用的下载链接');
  window.aglove.openExternal(url).catch((err) => showToast(`打开下载链接失败：${err.message}`));
}

async function copyUpdateLink() {
  const url = state.updateInfo?.downloadUrl || state.updateInfo?.homepage || '';
  if (!url) return showToast('没有可复制的下载链接');
  try {
    await navigator.clipboard.writeText(url);
    showToast('下载链接已复制');
  } catch (_) {
    showToast(url);
  }
}

async function loadSidebarAd() {
  clearSidebarAdTimers();
  try {
    const data = await window.aglove.getSidebarAd();
    state.sidebarAd = data;
    state.sidebarAdIndex = 0;
    renderSidebarAd();
    scheduleSidebarAdTimers();
    if (data?.enabled && data.ads?.length) log(`已加载侧边栏广告：${data.ads.length} 张。`);
    else log(`侧边栏广告未启用${data?.error ? `：${data.error}` : '。'}`);
  } catch (err) {
    state.sidebarAd = null;
    renderSidebarAd();
    log(`侧边栏广告加载失败：${err.message}`);
  }
}

function clearSidebarAdTimers() {
  if (state.sidebarAdRotateTimer) clearInterval(state.sidebarAdRotateTimer);
  if (state.sidebarAdRefreshTimer) clearTimeout(state.sidebarAdRefreshTimer);
  state.sidebarAdRotateTimer = null;
  state.sidebarAdRefreshTimer = null;
}

function scheduleSidebarAdTimers() {
  const data = state.sidebarAd;
  const ads = data?.ads || [];
  if (data?.enabled && ads.length > 1) {
    state.sidebarAdRotateTimer = setInterval(() => {
      state.sidebarAdIndex = (state.sidebarAdIndex + 1) % ads.length;
      renderSidebarAd();
    }, Math.max(3, Number(data.intervalSeconds || 5)) * 1000);
  }
  const refreshSeconds = Math.max(30, Number(data?.refreshSeconds || 300));
  state.sidebarAdRefreshTimer = setTimeout(loadSidebarAd, refreshSeconds * 1000);
}

function renderSidebarAd() {
  const box = $('#sidebarAd');
  if (!box) return;
  const ads = state.sidebarAd?.enabled ? (state.sidebarAd.ads || []) : [];
  const ad = ads[state.sidebarAdIndex % Math.max(ads.length, 1)];
  if (!ad) {
    box.classList.remove('loaded');
    box.removeAttribute('title');
    box.innerHTML = '<div class="sidebar-ad-placeholder">广告位</div>';
    return;
  }
  box.classList.add('loaded');
  box.title = ad.title || ad.alt || '广告';
  box.innerHTML = `<img src="${escapeAttr(ad.imageUrl)}" alt="${escapeAttr(ad.alt || ad.title || '广告')}" />`;
}

function openCurrentSidebarAd() {
  const ads = state.sidebarAd?.enabled ? (state.sidebarAd.ads || []) : [];
  const ad = ads[state.sidebarAdIndex % Math.max(ads.length, 1)];
  if (ad?.linkUrl) window.aglove.openExternal(ad.linkUrl).catch((err) => log(`打开广告链接失败：${err.message}`));
}

function bindColumnResize() {
  const table = $('#videoTable');
  if (!table) return;
  const colMap = { path: '.col-path', status: '.col-status', name: '.col-name' };
  const minWidth = { path: 220, status: 110, name: 180 };

  function lockTableColumnWidths() {
    const cols = [...table.querySelectorAll('col')];
    const headerCells = [...table.querySelectorAll('thead th')];
    let total = 0;
    cols.forEach((col, index) => {
      const width = Math.round(headerCells[index]?.getBoundingClientRect().width || col.getBoundingClientRect().width || 100);
      col.style.width = `${width}px`;
      total += width;
    });
    table.style.width = `${total}px`;
    table.style.minWidth = '100%';
  }

  function tablePixelWidth() {
    return [...table.querySelectorAll('col')].reduce((sum, col) => sum + (parseFloat(col.style.width) || col.getBoundingClientRect().width || 0), 0);
  }

  $$('.col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      lockTableColumnWidths();
      const th = handle.closest('th');
      const key = th.dataset.col;
      const col = table.querySelector(colMap[key]);
      if (!col) return;
      const startX = event.clientX;
      const startWidth = parseFloat(col.style.width) || col.getBoundingClientRect().width;
      document.body.classList.add('resizing-columns');
      const onMove = (moveEvent) => {
        const width = Math.max(minWidth[key] || 120, startWidth + moveEvent.clientX - startX);
        col.style.width = `${Math.round(width)}px`;
        table.style.width = `${Math.round(tablePixelWidth())}px`;
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.classList.remove('resizing-columns');
        showToast('列宽已调整');
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once: true });
    });
  });
}

async function loadSettings() {
  const data = await window.aglove.loadSettings();
  if (!data) return;
  $('#ollamaUrl').value = data.ollamaUrl || 'http://127.0.0.1:11434';
  setModelOptions(Array.isArray(data.modelList) ? data.modelList : [], data.modelName || 'llava');
  $('#shotCount').value = data.shotCount || 5;
  $('#timeoutSec').value = data.timeoutSec || 900;
  $('#autoRename').checked = !!data.autoRename;
  if (Array.isArray(data.segments) && data.segments.length) {
    state.segments = migrateSegments(data.segments);
    renderSegments();
  }
  log('已读取设置。');
  if (state.modelList.length) {
    setOllamaNotice('ok', `已恢复上次加载的 ${state.modelList.length} 个模型。正在后台检测 Ollama 连接…`);
    refreshModelsSilently();
  }
}


function migrateSegments(segments) {
  return segments.map((s, i, arr) => {
    const oldNextConnector = arr[i + 1]?.joinBefore ? (arr[i + 1]?.connector || '') : '';
    const suffix = s.suffix ?? oldNextConnector ?? s.connector ?? '';
    return {
      ...s,
      id: s.id || crypto.randomUUID(),
      name: normalizeSegmentName(s.name, i),
      joinBefore: false,
      suffix,
      connector: suffix,
    };
  });
}

async function checkOllamaInstall() {
  const notice = $('#ollamaInstallNotice');
  if (!notice) return;
  try {
    const result = await window.aglove.ollamaInstalled();
    if (!result.installed) {
      setOllamaNotice('warn', '当前电脑还没有检测到 Ollama。请先前往 <button id="ollamaNoticeBtn" class="link-button" type="button">Ollama 官网</button> 下载并安装，然后回到这里加载模型。');
      $('#ollamaNoticeBtn')?.addEventListener('click', () => window.aglove.openExternal('https://ollama.com'));
      log('未检测到 Ollama，请先安装后再加载模型。');
    } else {
      setOllamaNotice('ok', `已检测到 Ollama${result.version ? `：${escapeHtml(result.version)}` : ''}。点击“加载模型”即可读取本机模型列表。`);
      if (result.version) log(`已检测到 Ollama：${result.version}`);
    }
  } catch (_) {
    setOllamaNotice('warn', '未能检测 Ollama 安装状态。如无法加载模型，请先确认 Ollama 已安装并正在运行。');
  }
}

async function saveSettings() {
  syncSegmentsFromDom();
  const savedTo = await window.aglove.saveSettings(getSettings());
  log(`设置已保存：${savedTo}`);
  showToast('设置已保存');
}

function getSettings() {
  return {
    ollamaUrl: $('#ollamaUrl').value.trim(),
    modelName: $('#modelName').value.trim(),
    modelList: state.modelList,
    shotCount: Number($('#shotCount').value || 5),
    timeoutSec: Number($('#timeoutSec').value || 900),
    autoRename: $('#autoRename').checked,
    segments: state.segments,
  };
}

async function refreshModelsSilently() {
  try {
    const models = await window.aglove.ollamaTags({ baseUrl: $('#ollamaUrl').value.trim() });
    if (models.length) {
      const current = $('#modelName').value;
      setModelOptions(models, models.includes(current) ? current : current || models[0]);
      setOllamaNotice('ok', `已连接 Ollama，检测到 ${models.length} 个模型。已自动恢复上次选择。`);
      await window.aglove.saveSettings(getSettings());
      log(`已自动刷新模型列表：${models.join(', ')}`);
    } else {
      setOllamaNotice('warn', '已恢复上次模型列表，但当前 Ollama 没有返回可用模型。');
    }
  } catch (err) {
    setOllamaNotice('warn', `已恢复上次模型列表，但暂时无法连接 Ollama：${escapeHtml(err.message)}`);
    log(`自动刷新模型列表失败：${err.message}`);
  }
}

async function loadModels() {
  try {
    const models = await window.aglove.ollamaTags({ baseUrl: $('#ollamaUrl').value.trim() });
    if (models.length) {
      setModelOptions(models, $('#modelName').value || models[0]);
      setOllamaNotice('ok', `已连接 Ollama，检测到 ${models.length} 个模型。请选择要使用的模型。`);
      showToast(`已加载 ${models.length} 个模型`);
      await window.aglove.saveSettings(getSettings());
      log(`已加载模型：${models.join(', ')}`);
    } else {
      setOllamaNotice('warn', '已连接 Ollama，但没有检测到可用模型。请先在 Ollama 中下载视觉模型。');
      showToast('没有检测到可用模型');
      log('Ollama 没有返回模型列表。');
    }
  } catch (err) {
    setOllamaNotice('warn', `加载模型失败：${escapeHtml(err.message)}。请确认 Ollama 已启动，地址填写正确。`);
    showToast('加载模型失败');
    log(`加载模型失败：${err.message}`);
  }
}

function addPaths(paths) {
  const existing = new Set(state.videos.map((v) => v.path));
  let added = 0;
  for (const p of paths || []) {
    if (existing.has(p)) continue;
    state.videos.push({ id: crypto.randomUUID(), path: p, selected: true, status: '等待处理', newName: '', startedAt: null, elapsedMs: 0 });
    existing.add(p); added += 1;
  }
  renderVideos();
  log(`已添加 ${added} 个视频。`);
  showToast(`已添加 ${added} 个视频`);
}

function renderVideos() {
  renderVideoStatusSummary();
  const tbody = $('#videoRows');
  const filtered = filteredVideos();
  const activeFilter = Boolean(state.videoSearch || state.videoStatusFilter !== 'all');
  $('#countBadge').textContent = activeFilter ? `${filtered.length} / ${state.videos.length} 个视频` : `${state.videos.length} 个视频`;
  tbody.innerHTML = '';
  filtered.forEach((v, index) => {
    const tr = document.createElement('tr');
    if (state.videoSearch && index === 0) tr.classList.add('search-hit');
    tr.innerHTML = `
      <td class="sel"><input type="checkbox" ${v.selected ? 'checked' : ''} data-id="${v.id}" /></td>
      <td class="video-path-cell" title="点击用默认播放器打开：${escapeHtml(v.path)}" data-id="${v.id}">${highlightMatch(v.path, state.videoSearch)}</td>
      <td class="status">${escapeHtml(statusText(v))}</td>
      <td class="new-name">${highlightMatch(v.newName || '', state.videoSearch)}</td>`;
    tbody.appendChild(tr);
  });
  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    tr.innerHTML = '<td colspan="4">没有匹配的视频</td>';
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', () => {
    const item = state.videos.find((v) => v.id === cb.dataset.id);
    if (item) item.selected = cb.checked;
    updateSelectAllButton();
  }));
  tbody.querySelectorAll('.video-path-cell').forEach((cell) => cell.addEventListener('click', () => openVideoFromList(cell.dataset.id)));
  if (state.videoSearch) tbody.querySelector('.search-hit')?.scrollIntoView({ block: 'nearest' });
  updateSelectAllButton();
}

function renderVideoStatusSummary() {
  const wrap = $('#videoStatusSummary');
  if (!wrap) return;
  const counts = videoStatusCounts();
  const items = [
    ['总数', counts.total, 'total'],
    ['等待处理', counts.waiting, 'waiting'],
    ['处理中', counts.processing, 'processing'],
    ['已生成', counts.generated, 'generated'],
    ['已重命名', counts.renamed, 'renamed'],
    ['失败', counts.failed, 'failed'],
  ];
  wrap.innerHTML = items.map(([label, value, type]) => `
    <button class="status-chip ${type}" type="button" data-filter="${escapeAttr(statusFilterForChip(type))}">
      <span>${escapeHtml(label)}</span><b>${value}</b>
    </button>`).join('');
  wrap.querySelectorAll('.status-chip').forEach((chip) => chip.addEventListener('click', () => {
    const filter = chip.dataset.filter || 'all';
    state.videoStatusFilter = filter;
    const select = $('#videoStatusFilter');
    if (select) select.value = filter;
    renderVideos();
  }));
}

function statusFilterForChip(type) {
  return ({ total: 'all', waiting: '等待处理', processing: '处理中', generated: '已生成', renamed: '已重命名', failed: '失败' })[type] || 'all';
}

function videoStatusCounts() {
  const counts = { total: state.videos.length, waiting: 0, processing: 0, generated: 0, renamed: 0, failed: 0 };
  for (const video of state.videos) {
    const group = statusGroup(video.status);
    if (group === '等待处理') counts.waiting += 1;
    else if (group === '处理中' || group === '重命名中') counts.processing += 1;
    else if (group === '已生成') counts.generated += 1;
    else if (group === '已重命名') counts.renamed += 1;
    else if (group === '失败') counts.failed += 1;
  }
  return counts;
}

function filteredVideos() {
  const query = state.videoSearch.toLowerCase();
  return state.videos.filter((v) => {
    const matchesSearch = !query || [v.path, baseName(v.path), v.newName, v.status].some((part) => String(part || '').toLowerCase().includes(query));
    const matchesStatus = state.videoStatusFilter === 'all' || statusGroup(v.status) === state.videoStatusFilter;
    return matchesSearch && matchesStatus;
  });
}

function statusGroup(status) {
  const text = String(status || '等待处理');
  if (text === '失败') return '失败';
  if (text === '已生成') return '已生成';
  if (text === '已重命名') return '已重命名';
  if (text === '重命名中') return '重命名中';
  if (text === '等待处理') return '等待处理';
  if (text.includes('生成中') || text === '截图中') return '处理中';
  return text;
}

function clearVideoFilters() {
  state.videoSearch = '';
  state.videoStatusFilter = 'all';
  const search = $('#videoSearchInput');
  const filter = $('#videoStatusFilter');
  if (search) search.value = '';
  if (filter) filter.value = 'all';
  renderVideos();
}

function highlightMatch(text, query) {
  const raw = String(text || '');
  const q = String(query || '').trim();
  if (!q) return escapeHtml(raw);
  const lower = raw.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return escapeHtml(raw);
  return `${escapeHtml(raw.slice(0, idx))}<mark>${escapeHtml(raw.slice(idx, idx + q.length))}</mark>${escapeHtml(raw.slice(idx + q.length))}`;
}

function updateSelectAllButton() {
  const btn = $('#toggleSelectAllBtn');
  if (!btn) return;
  const allSelected = state.videos.length > 0 && state.videos.every((v) => v.selected);
  btn.textContent = allSelected ? '取消全选' : '全选';
}

async function openVideoFromList(id) {
  const item = state.videos.find((v) => v.id === id);
  if (!item?.path) return;
  try {
    await window.aglove.openFile(item.path);
    log(`已打开视频：${baseName(item.path)}`);
  } catch (err) {
    showToast(`打开视频失败：${err.message}`);
    log(`打开视频失败：${baseName(item.path)}，原因：${err.message}`);
  }
}

function statusText(item) {
  const elapsed = item.startedAt ? Date.now() - item.startedAt + (item.elapsedMs || 0) : (item.elapsedMs || 0);
  if (!elapsed) return item.status;
  return `${item.status} · ${formatElapsed(elapsed)}`;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function startUiTimer() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (state.processing) renderVideos();
  }, 1000);
}

function stopUiTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

function toggleSelectAll() {
  closeMoreActions();
  const shouldSelect = state.videos.some((v) => !v.selected);
  state.videos.forEach((v) => { v.selected = shouldSelect; });
  renderVideos();
  showToast(shouldSelect ? '已全选' : '已取消全选');
}

function selectFailedOrUnnamed() {
  closeMoreActions();
  state.videos.forEach((v) => { v.selected = v.status === '失败' || !v.newName; });
  renderVideos();
}

async function deleteSelectedFiles() {
  closeMoreActions();
  const selected = state.videos.filter((v) => v.selected);
  if (!selected.length) return showToast('请先选择要删除的文件');
  if (!confirm(`确定要把 ${selected.length} 个视频文件移到回收站吗？`)) return;
  try {
    const trashed = await window.aglove.trashFiles(selected.map((v) => v.path));
    const trashedSet = new Set(trashed);
    state.videos = state.videos.filter((v) => !trashedSet.has(v.path));
    renderVideos();
    log(`已移到回收站：${trashed.length} 个文件`);
    showToast(`已删除 ${trashed.length} 个文件`);
  } catch (err) {
    log(`删除选中文件失败：${err.message}`);
    showToast('删除失败');
  }
}

function pauseProcessing() {
  closeMoreActions();
  if (!state.processing) return;
  state.paused = true;
  log('已暂停。当前正在请求 Ollama 的任务会先等本次请求返回，再暂停后续任务。');
}

function resumeProcessing() {
  closeMoreActions();
  state.paused = false;
  showToast('已继续');
}

async function waitIfPaused() {
  while (state.paused) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function resetForReprocess(item) {
  item.status = '等待处理';
  item.newName = '';
  item.startedAt = null;
  item.elapsedMs = 0;
}


async function renameGeneratedFiles() {
  if (state.processing) return showToast('正在分析中，完成后再修改名称');
  const targets = state.videos.filter((v) => v.selected && v.newName && v.status !== '已重命名');
  if (!targets.length) {
    showToast('没有可修改名称的视频');
    return log('没有可修改名称的视频。请先分析生成新名称，并勾选要修改的视频。');
  }
  if (!confirm(`确定要把 ${targets.length} 个已生成名称的视频重命名吗？`)) return;
  let ok = 0;
  for (const item of targets) {
    try {
      item.status = '重命名中';
      item.startedAt = Date.now();
      renderVideos();
      const newPath = await window.aglove.renameFile({ filePath: item.path, newBaseName: item.newName });
      item.path = newPath;
      item.status = '已重命名';
      item.elapsedMs += Date.now() - item.startedAt;
      item.startedAt = null;
      ok += 1;
      log(`已修改名称：${newPath}`);
    } catch (err) {
      item.status = '失败';
      if (item.startedAt) { item.elapsedMs += Date.now() - item.startedAt; item.startedAt = null; }
      log(`修改名称失败：${baseName(item.path)}，原因：${err.message}`);
    }
  }
  renderVideos();
  showToast(`已修改 ${ok} 个视频名称`);
}

function reanalyzeSelected() {
  closeMoreActions();
  const targets = state.videos.filter((v) => v.selected);
  targets.forEach(resetForReprocess);
  renderVideos();
  startProcessing({ targets });
}

function retryFailedOrUnnamed() {
  closeMoreActions();
  const targets = state.videos.filter((v) => v.status === '失败' || !v.newName);
  targets.forEach((v) => { v.selected = true; resetForReprocess(v); });
  renderVideos();
  startProcessing({ targets });
}

function removeSelected() {
  closeMoreActions();
  const before = state.videos.length;
  state.videos = state.videos.filter((v) => !v.selected);
  renderVideos();
  showToast(`已移除 ${before - state.videos.length} 个视频`);
}

function addSegment() {
  syncSegmentsFromDom();
  const n = state.segments.length + 1;
  state.segments.push({
    id: crypto.randomUUID(), enabled: true, name: `标题${String(n).padStart(2, '0')}`, prefix: '', joinBefore: true, suffix: '', connector: '',
    rule: '写清楚这个标题段要生成什么。要求模型只输出这一段的最终内容，不要解释，不要扩展名。',
  });
  renderSegments();
  showToast(`已添加${state.segments[state.segments.length - 1].name}`);
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
      <div class="segment-body">
        <div class="segment-row segment-row-main">
          <label>标题段名称<input class="seg-name" value="${escapeAttr(normalizeSegmentName(seg.name, index))}" placeholder="例如：标题01" /></label>
          <label>固定前缀<input class="seg-prefix" value="${escapeAttr(seg.prefix || '')}" placeholder="可空，如 T=" /></label>
          <label>固定后缀<input class="seg-suffix" type="text" value="${escapeAttr(seg.suffix ?? seg.connector ?? '')}" placeholder="例如 __" /></label>
        </div>
        <label class="rule-field">生成规则<textarea class="seg-rule">${escapeHtml(seg.rule || '')}</textarea></label>
        <div class="segment-foot">
          <label class="switch-line"><input class="seg-enabled" type="checkbox" ${seg.enabled ? 'checked' : ''} /> 启用这个标题段</label>
          <span>预览：${escapeHtml(`${seg.prefix || ''}${normalizeSegmentName(seg.name, index)}${seg.suffix ?? seg.connector ?? ''}`)}</span>
        </div>
      </div>`;
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
    name: card.querySelector('.seg-name').value.trim() || `标题${String(i + 1).padStart(2, '0')}`,
    prefix: card.querySelector('.seg-prefix').value,
    joinBefore: false,
    suffix: card.querySelector('.seg-suffix').value,
    connector: card.querySelector('.seg-suffix').value,
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
  showToast('标题段顺序已调整');
}

function deleteSegment(id) {
  syncSegmentsFromDom();
  state.segments = state.segments.filter((s) => s.id !== id);
  renderSegments();
  showToast('已删除标题段');
}

function updatePatternPreview() {
  const parts = [];
  for (const seg of state.segments.filter((s) => s.enabled)) {
    const token = `${seg.prefix || ''}${seg.name || '标题'}${seg.suffix ?? seg.connector ?? ''}`;
    parts.push(token);
  }
  $('#patternPreview').textContent = parts.join('') || '未启用任何名称段';
}

async function startProcessing({ targets } = {}) {
  if (state.processing) return;
  syncSegmentsFromDom();
  const settings = getSettings();
  targets = (targets || state.videos.filter((v) => v.selected)).filter(Boolean);
  if (!targets.length) return log('请先选择要处理的视频。');
  if (!settings.segments.some((s) => s.enabled && s.rule.trim())) return log('请至少启用一个有规则的名称段。');

  state.processing = true;
  state.paused = false;
  $('#startBtn').disabled = true;
  startUiTimer();
  try {
    for (const item of targets) {
      await waitIfPaused();
      await processOne(item, settings);
      renderVideos();
    }
  } finally {
    state.processing = false;
    state.paused = false;
    $('#startBtn').disabled = false;
    stopUiTimer();
    renderVideos();
    log('处理完成。');
    showToast('处理完成');
  }
}

async function processOne(item, settings) {
  try {
    item.status = '截图中'; item.startedAt = Date.now(); item.elapsedMs = item.elapsedMs || 0; renderVideos();
    log(`开始处理：${baseName(item.path)}`);
    const images = await captureScreenshots(item.path, settings.shotCount);
    const savedShots = await window.aglove.saveScreenshots({ filePath: item.path, images });
    log(`已截图 ${images.length} 张：${baseName(item.path)}`);
    if (savedShots?.dir) log(`截图已保存：${savedShots.dir}`);

    const outputs = [];
    for (const seg of settings.segments.filter((s) => s.enabled)) {
      await waitIfPaused();
      item.status = `${seg.name} 生成中`; renderVideos();
      const value = await generateSegment(seg, item.path, images, settings);
      outputs.push({ seg, value });
      log(`${seg.name}：${value}`);
    }

    const finalName = combineOutputs(outputs);
    item.newName = finalName;
    item.status = '已生成';
    item.elapsedMs += Date.now() - item.startedAt;
    item.startedAt = null;
    log(`生成名称：${baseName(item.path)} -> ${finalName}`);

    if (settings.autoRename) {
      const newPath = await window.aglove.renameFile({ filePath: item.path, newBaseName: finalName });
      item.path = newPath;
      item.status = '已重命名';
      log(`已重命名：${newPath}`);
    }
  } catch (err) {
    item.status = '失败';
    if (item.startedAt) { item.elapsedMs += Date.now() - item.startedAt; item.startedAt = null; }
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
  const englishMode = isEnglishRule(seg);
  const retry = attempt > 1
    ? (englishMode
      ? `\n\nPrevious output was invalid. Do not repeat it. Previous output: ${lastRaw.slice(0, 180)}\nRegenerate now. Output only the final valid content.`
      : `\n\n上一轮输出违规，不要重复。上一轮内容：${lastRaw.slice(0, 180)}\n现在重新输出，必须只输出纯内容。`)
    : '';
  if (englishMode) {
    return `You are a video file naming assistant. The images are screenshots from the same video.\n\nGenerate only this segment: ${seg.name}\nOutput prefix: ${seg.prefix || 'none'}\nOriginal filename for reference only: ${baseName(filePath)}\nIf the original filename contains Chinese or non English useful keywords, translate the meaning into natural English. Do not copy Chinese text into the final output.\n\nSegment rule:\n${seg.rule}\n\nHard rules:\n1. Output only the final content for ${seg.name}.\n2. Use English only. Do not output Chinese or any non English words.\n3. Do not explain, analyze, or restate the rules.\n4. Do not output a file extension.\n5. Do not output incomplete words or unfinished fragments.\n6. If commas are required, use half width English commas only.\n${retry}`;
  }
  return `你是视频文件命名助手。图片来自同一个视频。\n\n当前只生成这一段：${seg.name}\n输出前缀：${seg.prefix || '无'}\n原文件名：${baseName(filePath)}\n\n这一段的命名规则：\n${seg.rule}\n\n硬性规则：\n1. 只输出${seg.name}的最终内容本身。\n2. 不要解释，不要分析过程，不要复述规则。\n3. 不要输出“需要再加”“多少字”“标题为”“文件名”等说明。\n4. 不要输出扩展名。\n5. 如果需要多个词，只能按用户规则使用英文逗号。\n${retry}`;
}

function cleanSegmentOutput(raw, seg) {
  const isList = isListSegment(seg);
  const englishMode = isEnglishRule(seg);
  let text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```/g, '').trim();
  text = text.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean).pop() || text;
  text = text.replace(/^\s*(?:T|C|G|标题|名称|文件名|分类|标签|结果|输出)\s*[:：=]\s*/i, '');
  const quoted = [...text.matchAll(/[“‘"']([^”’"']{2,})[”’"']/g)].map((m) => m[1]);
  if (quoted.length) text = quoted[quoted.length - 1];
  text = text.replace(/\s*(?:->|→|⇒|➡).*?(?:\d+\s*(?:个?字|字符)|字数).*$/g, '');
  text = text.replace(/[（(【\[]\s*\d+\s*(?:个?字|字符)\s*[）)】\]]\s*$/g, '');
  text = text.replace(/(?:是|为|标题|文件名)$/g, '');
  text = text.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '');
  if (isList) {
    text = text.replace(/[，、；;\s]+/g, ',').replace(/,+/g, ',').replace(/^,|,$/g, '');
    if (englishMode) text = text.split(',').map((x) => cleanEnglishToken(x)).filter(Boolean).join(',');
  } else if (englishMode) {
    text = text
      .replace(/[，。、《》？！；：‘’“”"'`·•…—–~～,.;:!?()（）\[\]【】{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } else {
    text = text.replace(/[，。、《》？！；：‘’“”"'`·•…—–~～,.;:!?()（）\[\]【】{}]/g, '').replace(/\s+/g, '');
  }
  return text.trim();
}

function validateSegment(text, seg) {
  if (!text) return { ok: false, reason: '内容为空' };
  const forbidden = ['用户', '要求', '规则', '提示词', '需要', '再加', '字数', '个字', '字符', '输出', '解释', '截图', '图片', '首先', '分析', '应该', '可以', '符合', '格式', '文件名', '标题为'];
  const hit = forbidden.find((w) => text.includes(w));
  if (hit) return { ok: false, reason: `包含说明词：${hit}` };
  if (/[→⇒➡]/.test(text)) return { ok: false, reason: '包含箭头说明' };
  if (/\d+\s*(个?字|字符)/.test(text)) return { ok: false, reason: '包含字数说明' };
  if (isEnglishRule(seg) && /[\u3400-\u9fff]/.test(text)) return { ok: false, reason: '英文模式下包含中文' };
  if (isListSegment(seg)) {
    if (/\s/.test(text)) return { ok: false, reason: '分类/标签包含空格' };
    if (isEnglishRule(seg) && /[^a-zA-Z0-9_,\-]/.test(text)) return { ok: false, reason: '分类/标签包含非英文字符' };
  } else {
    if (/\d/.test(text)) return { ok: false, reason: '标题包含数字' };
    if (/[，。、《》？！；：‘’“”"'`·•…—–~～,.;:!?()（）\[\]【】{}]/.test(text)) return { ok: false, reason: '标题包含标点' };
    if (isEnglishRule(seg)) {
      const words = englishWords(text);
      if (words.length < 4) return { ok: false, reason: '英文标题过短或未完整生成' };
      if (/\b[a-zA-Z]$/.test(text) && words.length >= 8) return { ok: false, reason: '英文标题疑似截断半个词' };
    }
  }
  return { ok: true };
}

function isListSegment(seg) {
  return seg.prefix === 'C=' || seg.prefix === 'G=' || /分类|标签|category|tag/i.test(seg.name);
}

function isEnglishRule(seg) {
  return /\bEnglish\b|lowercase English|WordPress categories|WordPress tags|video title generator/i.test(`${seg.name || ''}\n${seg.rule || ''}`);
}

function englishWords(text) {
  return String(text || '').match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
}

function cleanEnglishToken(token) {
  return String(token || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .trim();
}

function combineOutputs(outputs) {
  let final = '';
  outputs.forEach(({ seg, value }, i) => {
    const part = `${seg.prefix || ''}${value}`;
    final += `${part}${seg.suffix ?? seg.connector ?? ''}`;
  });
  return sanitizeFileName(final);
}

function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim() || '未命名视频';
}

async function captureScreenshots(filePath, count) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  if (ext === 'ts') return window.aglove.captureScreenshots({ filePath, count });
  const video = $('#captureVideo');
  const canvas = $('#captureCanvas');
  const url = pathToFileUrl(filePath);
  video.removeAttribute('src');
  video.src = url;
  try {
    await once(video, 'loadedmetadata', 30000);
  } catch (err) {
    video.removeAttribute('src');
    log(`浏览器内置解码失败，改用 FFmpeg 截图：${err.message}`);
    return window.aglove.captureScreenshots({ filePath, count });
  }
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
  const width = video.videoWidth || 960;
  const height = video.videoHeight || 540;
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  const n = Math.max(1, Math.min(12, Number(count || 5)));
  const times = n === 1 ? [duration / 2] : Array.from({ length: n }, (_, i) => duration * (0.12 + (0.76 * i) / (n - 1)));
  const images = [];
  let blackFrames = 0;
  for (const t of times) {
    video.currentTime = Math.min(duration - 0.05, Math.max(0, t));
    await once(video, 'seeked', 15000);
    await waitVideoFrame(video);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (isMostlyBlackCanvas(canvas, ctx)) blackFrames += 1;
    images.push(canvas.toDataURL('image/jpeg', 0.88).split(',')[1]);
  }
  video.removeAttribute('src');
  if (images.length && blackFrames >= Math.max(1, Math.ceil(images.length * 0.6))) {
    log(`检测到 ${blackFrames}/${images.length} 张截图接近全黑，改用 FFmpeg 重新截图。`);
    return window.aglove.captureScreenshots({ filePath, count });
  }
  return images;
}

function waitVideoFrame(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      const timer = setTimeout(resolve, 1200);
      video.requestVideoFrameCallback(() => {
        clearTimeout(timer);
        resolve();
      });
      return;
    }
    setTimeout(resolve, 250);
  });
}

function isMostlyBlackCanvas(canvas, ctx) {
  const width = canvas.width;
  const height = canvas.height;
  if (!width || !height) return true;
  const sampleWidth = Math.min(96, width);
  const sampleHeight = Math.min(96, height);
  const data = ctx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let dark = 0;
  let total = 0;
  let brightnessSum = 0;
  for (let i = 0; i < data.length; i += 16) {
    const brightness = data[i] + data[i + 1] + data[i + 2];
    brightnessSum += brightness;
    if (brightness < 36) dark += 1;
    total += 1;
  }
  return total > 0 && dark / total > 0.96 && brightnessSum / total < 24;
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
  let filePath = String(p || '').replace(/\\/g, '/');
  if (!filePath.startsWith('/')) filePath = `/${filePath}`;
  const encoded = filePath.split('/').map((part, index) => {
    if (index === 0) return '';
    if (index === 1 && /^[A-Za-z]:$/.test(part)) return part;
    return encodeURIComponent(part);
  }).join('/');
  return `file://${encoded}`;
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
