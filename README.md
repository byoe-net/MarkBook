<div align="center">
  <h1>码客书 (MarkBook)</h1>
  <p><em>Online eBook editor & publishing platform</em></p>
  <p>在线电子书写作与发布平台</p>
  <p>
    <a href="#features">English</a> ·
    <a href="#功能">中文</a>
  </p>
</div>

---

## Features

- **Multi-book management** — Create, import, export (EPUB/PDF/DOCX/LaTeX/HTML/PNG)
- **Live Markdown editor** — Split-pane preview, syntax highlighting, KaTeX, Mermaid diagrams, `===highlight===`
- **Mobile reader** (`/reader`) — Table of contents drawer, font/size/dark mode, swipe navigation
- **AI writing assistant** — Select text to query, streaming SSE chat, configurable LLM backend
- **Code sandbox** — Isolated Python execution (disabled by default, enable via `MARKBOOK_SANDBOX_ENABLED=true`)
- **Full-text search** — Cross-chapter keyword search
- **Asset manager** — File upload with type whitelist + 50MB limit
- **Auto-save** — localStorage + server-side persistence
- **Dark mode** — Follows system preference
- **PWA** — Installable as desktop/mobile app
- **Offline-capable editor** — Open `index.html` directly for single-document editing

## Quick Start

```bash
pip install -r requirements.txt
python server.py
# → http://localhost:8765
```

Open `http://localhost:8765` in your browser.

### AI Assistant (optional)

```bash
cp .env.example .env
# Edit .env with your LLM API key
```

## Export Formats

| Format | How |
|---|---|
| PDF | Browser print (Ctrl+P) |
| PNG | html2canvas + custom watermark |
| Markdown | Download .md file |
| EPUB / DOCX / LaTeX / HTML | Built-in exporter |

---

## 功能

- **多书籍管理** — 创建、导入、导出（EPUB/PDF/DOCX/LaTeX/HTML/PNG）
- **实时 Markdown 编辑器** — 双栏预览、语法高亮、KaTeX 公式、Mermaid 图表、`===高亮===` 语法
- **移动阅读器** (`/reader`) — 目录抽屉、字体/行距/深色模式调节、左右滑动翻章
- **AI 助教** — 选中文本提问、流式 SSE 对话
- **代码沙箱** — 隔离执行 Python 代码（默认关闭）
- **全文搜索** — 跨章节关键词搜索
- **资源管理** — 文件上传（类型白名单 + 50MB 限制）
- **自动保存** — localStorage + 服务端持久化
- **深色模式** — 跟随系统偏好
- **PWA** — 可安装为桌面/移动应用
- **离线编辑** — 直接打开 `index.html` 即可写单文档

## 快速开始

```bash
pip install -r requirements.txt
python server.py
# → http://localhost:8765
```

浏览器打开 `http://localhost:8765`。

### AI 助教（可选）

```bash
cp .env.example .env
# 编辑 .env 填入 LLM API Key
```

## 导出格式

| 格式 | 方式 |
|---|---|
| PDF | 浏览器打印 (Ctrl+P) |
| PNG | html2canvas + 自定义水印 |
| Markdown | 下载 .md 文件 |
| EPUB / DOCX / LaTeX / HTML | 内置导出器 |

---

## Directory Structure / 目录结构

```
MarkBook/
├── server.py             # Entry: start server + auto-import books
├── server/app.py         # FastAPI app (CRUD/search/AI/sandbox/static)
├── index.html            # Desktop editor
├── reader.html           # Mobile reader
├── scripts/
│   ├── main.js           # Editor core logic
│   ├── project.js        # Multi-book management
│   └── exporter.js       # Export functionality
├── styles/style.css      # Custom styles
├── lib/                  # Vendored dependencies (no CDN, offline-ready)
├── library/              # Preset book sources
│   └── building-agents/  # "Building Agents: From Theory to Practice"
├── icons/                # PWA icons
├── .env.example          # Config template
├── requirements.txt      # Python dependencies
└── LICENSE               # MIT
```

## Tech Stack / 技术栈

| Backend | Frontend |
|---|---|
| Python 3 + FastAPI | Vanilla JS (no framework) |
| uvicorn | Tailwind CSS (pre-compiled) |
| SQLite (FTS5 search) | Marked.js + DOMPurify |
| httpx (LLM proxy) | highlight.js + KaTeX + Mermaid |

## License

MIT
