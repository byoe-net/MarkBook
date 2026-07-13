<div align="center">
  <h1>码客书 MarkBook</h1>
  <p><strong>创作 · 讲解 · 传播</strong></p>
  <p><em>一站式电子书工作台，为知识博主而生</em></p>
  <p>
    <a href="#features"><img src="https://img.shields.io/badge/lang-English-blue" alt="English"></a>
    <a href="#功能"><img src="https://img.shields.io/badge/lang-中文-red" alt="中文"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT"></a>
  </p>
</div>

---

## Features

MarkBook is an all-in-one eBook workstation designed for **knowledge creators, educators, and technical writers**.

### ✍️ Content Creation
- **Markdown editor** with live split-pane preview
- **Code syntax highlighting** (40+ languages via highlight.js)
- **KaTeX math formulas** & **Mermaid diagrams** — perfect for STEM content
- **`===highlight===`** syntax, **typewriter mode**, **focus mode**
- **AI writing assistant** — select text & ask questions, streaming chat
- **Auto-save** — never lose your draft

### 🎤 Live Presentation (PPT Mode)
- Turn any chapter into slides with one click
- Slides split by headings, navigate with arrow keys
- **Fullscreen, no distractions** — ideal for online classes & recordings

### 🔊 Text-to-Speech (TTS)
- Read aloud any chapter with browser-native speech synthesis
- **Speed control** (0.5x–2x), pause/resume, chunk-by-chunk reading
- Great for **listening while commuting** or **language learning**

### 📱 Multi-Device Reading
- **Mobile reader** (`/reader`) — automatic redirect on phones/WeChat
- Drawer table of contents, font/size adjustment, **dark mode**
- **Swipe** left/right to change chapters
- **PWA** — install as app on desktop & mobile

### 📦 Export Any Format
| Format | Use Case |
|---|---|
| **PNG** | Social media cards, WeChat Moments |
| **PDF** | Print, handouts |
| **HTML** | Web publishing |
| **EPUB** | eBook readers (Kindle, Apple Books) |
| **DOCX** | Word, further editing |
| **LaTeX** | Academic papers |
| **Markdown** | Portability |

### ⚡ More
- **Full-text search** across all chapters
- **Multi-book management** — create, import, organize
- **Asset manager** — file upload with type whitelist
- **Code sandbox** — run Python demos inside your book
- **Dark mode**, keyboard shortcuts, auto word count
- **Offline-capable** — open `index.html` directly for single-doc editing

---

## 功能

码客书（MarkBook）是一个**一站式电子书工作台**，专为知识博主、教育者和技术作者打造。

### ✍️ 内容创作
- **Markdown 编辑器**，实时双栏预览，所见即所得
- **代码语法高亮**（40+ 语言，highlight.js）
- **KaTeX 数学公式** & **Mermaid 图表** — 理工科内容利器
- **`===高亮===`** 语法、**打字机模式**、**聚焦模式**
- **AI 助教** — 选中文字直接提问，流式对话
- **自动保存** — 写作永不丢失

### 🎤 在线讲解（演示模式 / PPT）
- 一键将任意章节转为幻灯片
- 按标题自动分页，**← → 方向键翻页**
- **全屏无干扰** — 适合直播课、录课、会议分享
- 配合 TTS 朗读可自动播放

### 🔊 语音朗读 (TTS)
- 浏览器原生语音合成，**朗读整个章节**
- **语速可调**（0.5x–2x），暂停/继续/停止
- 支持**逐段朗读**，当前段落高亮跟踪
- 适合**通勤听书**、**语言学习**、**课程回放补充**

### 📱 多端阅读
- **移动阅读器** (`/reader`) — 手机/微信浏览器自动跳转
- **目录抽屉**、字体/行距调节、**深色模式**
- **左右滑动翻章**，原生 App 级体验
- **PWA** — 可安装到桌面和手机，离线可用

### 📦 导出多种格式
| 格式 | 适用场景 |
|---|---|
| **PNG 图片** | 朋友圈、公众号封面、社交媒体 |
| **PDF** | 打印、讲义分发 |
| **HTML** | 网页发布 |
| **EPUB** | 电子书阅读器（Kindle、Apple Books） |
| **DOCX** | Word 继续编辑 |
| **LaTeX** | 学术论文、出版 |
| **Markdown** | 原始数据，跨平台迁移 |

### ⚡ 更多
- **全文搜索** — 跨章节关键词查找
- **多书籍管理** — 创建、导入、组织多个作品
- **资源管理** — 图片/文件上传（类型白名单 + 50MB）
- **代码沙箱** — 书内直接运行 Python demo（默认关闭）
- **深色模式**、快捷键、实时字数统计
- **离线编辑** — 直接双击 `index.html` 即可写单文档

### 知识博主工作流

```
写 → Markdown 编辑器 + AI 助教
讲 → 演示模式 (PPT) + TTS 朗读
发 → PNG/PDF/EPUB/HTML 多格式导出
读 → 移动阅读器 / PWA 手机 App
```

---

## Quick Start / 快速开始

```bash
pip install -r requirements.txt
python server.py
# → http://localhost:8765
```

**One command, everything works.** 一条命令，全部就绪。

### AI Assistant (optional)

```bash
cp .env.example .env
# Fill in your LLM API key
```

---

## Directory Structure / 目录结构

```
码客书/
├── server.py             # 入口：启动 + 自动导入
├── server/app.py         # FastAPI 后端
├── index.html            # 桌面编辑器 ← 离线也能打开
├── reader.html           # 移动阅读页
├── scripts/
│   ├── main.js           # 编辑器核心（演示/TTS/聚焦...）
│   ├── project.js        # 多书籍管理
│   └── exporter.js       # 多格式导出
├── styles/style.css      # 自定义样式
├── lib/                  # 本地依赖，无 CDN
├── icons/                # PWA 图标
├── .env.example          # 配置模板
├── requirements.txt      # Python 依赖
└── LICENSE               # MIT
```

## Tech Stack / 技术栈

| Backend | Frontend |
|---|---|
| Python 3 + FastAPI | Vanilla JS (zero framework) |
| uvicorn | Tailwind CSS (pre-compiled, 22KB) |
| httpx (LLM proxy) | Marked.js + DOMPurify |
| subprocess (sandbox) | highlight.js + KaTeX + Mermaid |

## License

MIT
