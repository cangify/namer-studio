# AGLove视频自动命名 Electron版

旧版 Python 脚本 `../AGLove视频自动命名.py` 已保留不动。本目录是新的 Electron 桌面软件源码。

## 开发运行

```bash
npm install
npm start
```

## 检查

```bash
npm run check
```

## 打包

Windows zip：

```bash
npm run pack:win
```

Linux AppImage：

```bash
npm run pack:linux
```

## 命名规则设计

- 命名模板页支持多个片段：标题、分类、标签、自定义片段……
- 点击 `+ 添加片段` 可以继续添加更多自定义片段。
- 每个片段都可以设置：
  - 片段名称
  - 输出前缀（例如 `T=`、`C=`、`G=`）
  - 是否启用
  - 是否和前一段使用连接符
  - 连接符内容（例如 `__`）
  - 独立的名称规则
- 每个名称模块会独立调用 Ollama。
- 输出会进行硬校验；如果模型输出说明文字、字数、标点、`需要再加3` 等违规内容，会自动重试，连续失败则拒绝采用。

## 注意

视频截图在 Electron 渲染进程里通过隐藏 video + canvas 完成，不依赖 ffmpeg。
