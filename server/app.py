"""
server/app.py — MarkBook 在线服务平台

一条命令启动:
  python -m server.app                    # 默认 http://localhost:8765
  python -m server.app --port 8765        # 指定端口
  python -m server.app --book book --host 0.0.0.0

功能:
  - 提供静态文件服务 (index.html → 前端)
  - 多书籍管理 CRUD
  - 章节管理 CRUD + 自动保存
  - 资源文件上传/下载 (图片、代码、素材)
  - AI 助教对话 (代理到外部 LLM / 本地 Mock)
  - 代码沙箱 (在线运行 Python demo)
  - 搜索全文 (fTS5)
"""

import os, sys, json, re, shutil, mimetypes, argparse, hashlib, uuid, time, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

# 加载 .env 文件（如果存在）
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.is_file():
    for _line in _env_path.read_text("utf-8").strip().split("\n"):
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            _k = _k.strip()
            _v = _v.strip()
            if _k not in os.environ:
                os.environ[_k] = _v
from typing import Optional
from enum import Enum

import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body, Query
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ── 路径配置 ──────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
BOOKS_DIR = BASE_DIR / "server" / "books"
UPLOADS_DIR = BASE_DIR / "uploads"
# 预置书籍源码目录 — 扫描 library/ 下所有子目录
PRESET_BOOK_SOURCES = {}
_bookshelf = BASE_DIR / "library"
if _bookshelf.is_dir():
    for _d in sorted(_bookshelf.iterdir()):
        if _d.is_dir() and not _d.name.startswith("."):
            _meta = (_d / "book.json")
            _title = _d.name
            _description = ""
            if _meta.is_file():
                try:
                    _mj = json.loads(_meta.read_text("utf-8"))
                    _title = _mj.get("title", _d.name)
                    _description = _mj.get("description", "")
                except:
                    pass
            PRESET_BOOK_SOURCES[_d.name] = {"path": _d, "title": _title, "description": _description}

os.makedirs(BOOKS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

app = FastAPI(title="MarkBook Server", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── 工具函数 ──────────────────────────────────────────

def natural_sort_key(s):
    return [int(c) if c.isdigit() else c.lower() for c in re.split(r"(\d+)", s)]

def safe_filename(name):
    return re.sub(r'[<>:"/\\|?*]', '_', name)

def read_json(path):
    if path.is_file():
        try: return json.loads(path.read_text("utf-8"))
        except: pass
    return {}

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

def read_book(path):
    return read_json(path)

# 把预置书籍信息挂到 app.state
@app.on_event("startup")
async def _store_presets():
    app.state.PRESET = PRESET_BOOK_SOURCES

# ── 书籍管理 ──────────────────────────────────────────

def list_books():
    books = []
    for d in sorted(BOOKS_DIR.iterdir(), key=lambda p: natural_sort_key(p.name)):
        if not d.is_dir(): continue
        meta = read_book(d / "book.json")
        books.append({
            "id": d.name,
            "title": meta.get("title", d.name),
            "author": meta.get("author", ""),
            "cover": meta.get("cover", ""),
            "description": meta.get("description", ""),
            "chapter_count": len(list_chapters(d.name)),
            "updated_at": meta.get("updated_at", ""),
        })
    return books

def list_chapters(book_id):
    book_dir = BOOKS_DIR / book_id
    if not book_dir.is_dir():
        return []
    chapters = []
    for entry in sorted(book_dir.iterdir(), key=lambda x: natural_sort_key(x.name)):
        md_file = entry / "chapter.md"
        if not md_file.is_file():
            continue
        ch_id = entry.name
        title = ch_id
        status = ""
        try:
            head = md_file.read_text("utf-8").strip().split("\n")[:8] if md_file.stat().st_size > 0 else []
            if head and head[0].startswith("# "):
                title = head[0][2:].strip()
            # 过稿状态行（BYOE-Director markbook_sync 导出的章节头部 blockquote）
            for line in head:
                if line.startswith(">"):
                    m = re.search(r"状态[：:]\s*([^\s｜|]+)", line)
                    if m:
                        status = m.group(1)
                        break
        except:
            pass
        # 资源计数
        resources = list_resources(book_id, ch_id)
        chapters.append({"id": ch_id, "title": title, "status": status, "resources": len(resources)})
    return chapters

# ── 资源管理 ──────────────────────────────────────────

def list_resources(book_id, chapter_id=None):
    base = UPLOADS_DIR / book_id
    if chapter_id:
        base = base / chapter_id
    if not base.is_dir():
        return []
    result = []
    for f in sorted(base.iterdir(), key=lambda x: natural_sort_key(x.name)):
        if f.is_file():
            rel = f.relative_to(UPLOADS_DIR).as_posix()
            result.append({
                "name": f.name,
                "path": rel,
                "url": f"/uploads/{rel}",
                "size": f.stat().st_size,
            })
    return result

# ── API 路由 ──────────────────────────────────────────

# ── 书籍 ──
@app.get("/api/presets")
def api_list_presets():
    """列出可导入的预置书籍源"""
    result = []
    for key, info in PRESET_BOOK_SOURCES.items():
        path = info["path"]
        if path.is_dir():
            md_count = len([p for p in path.rglob("*.md") if "images" not in p.parts])
            result.append({"key": key, "title": info["title"], "path": str(path), "md_count": md_count})
    return result

@app.get("/api/books")
def api_list_books():
    return list_books()

@app.post("/api/books")
def api_create_book(title: str = Form("新书籍"), author: str = Form(""), description: str = Form("")):
    book_id = safe_filename(title.strip() or "新书籍")
    book_dir = BOOKS_DIR / book_id
    if book_dir.is_dir():
        book_id = book_id + "_" + str(int(time.time()))
        book_dir = BOOKS_DIR / book_id
    book_dir.mkdir(parents=True, exist_ok=True)
    meta = {"title": title, "author": author, "description": description, "created_at": time.strftime("%Y-%m-%d %H:%M:%S"), "updated_at": time.strftime("%Y-%m-%d %H:%M:%S")}
    write_json(book_dir / "book.json", meta)
    return {"id": book_id, **meta}

@app.get("/api/books/{book_id}")
def api_get_book(book_id: str):
    meta = read_book(BOOKS_DIR / book_id / "book.json")
    if not meta:
        raise HTTPException(404, "书籍不存在")
    return {"id": book_id, **meta, "chapters": list_chapters(book_id)}

@app.put("/api/books/{book_id}")
def api_update_book(book_id: str, data: dict = Body(...)):
    meta_file = BOOKS_DIR / book_id / "book.json"
    meta = read_book(meta_file)
    meta.update({k: v for k, v in data.items() if k in ("title", "author", "cover", "description")})
    meta["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
    write_json(meta_file, meta)
    return {"ok": True}

@app.delete("/api/books/{book_id}")
def api_delete_book(book_id: str):
    book_dir = BOOKS_DIR / book_id
    if not book_dir.is_dir():
        raise HTTPException(404, "书籍不存在")
    shutil.rmtree(book_dir)
    # 清理上传资源
    upload_dir = UPLOADS_DIR / book_id
    if upload_dir.is_dir():
        shutil.rmtree(upload_dir)
    return {"ok": True}

@app.post("/api/books/import")
def api_import_book(data: dict = Body({"source": "book"})):
    """从预置目录导入生成新书籍"""
    source_key = data.get("source", "book")
    src_info = PRESET_BOOK_SOURCES.get(source_key)
    if not src_info:
        # 列出可用的源
        available = list(PRESET_BOOK_SOURCES.keys())
        raise HTTPException(400, f"未知的预置书籍源: {source_key}，可选: {available}")
    src_dir = src_info["path"]
    if not src_dir.is_dir():
        raise HTTPException(400, f"预置目录不存在: {src_dir}")
    default_title = src_info["title"]
    book_id = safe_filename(default_title)
    dest = BOOKS_DIR / book_id
    if dest.is_dir():
        return {"id": book_id, "title": default_title, "note": "书籍已存在", "chapters": list_chapters(book_id)}
    chapter_count = 0
    # 递归扫描所有 .md 文件
    md_files = []
    for md_path in sorted(src_dir.rglob("*.md"), key=lambda x: str(x)):
        # 跳过 README.md 根目录
        if md_path.name == "README.md" and md_path.parent == src_dir:
            continue
        # 跳过 images/ 等资源目录中的 md
        if "images" in md_path.parts or "assets" in md_path.parts:
            continue
        md_files.append(md_path)
    for md_path in md_files:
        rel = md_path.relative_to(src_dir)
        parts = list(rel.parts[:-1])  # 目录层级
        ch_id = "-".join(parts) if parts else md_path.stem
        if len(ch_id) > 100:
            ch_id = md_path.stem
        ch_dir = dest / ch_id
        ch_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(md_path, ch_dir / "chapter.md")
        chapter_count += 1
        # 复制同目录下的非 .md 文件（demo、图片等）
        for f in md_path.parent.iterdir():
            if f == md_path:
                continue
            if f.is_dir():
                continue
            dst = ch_dir / f.name
            if not dst.exists():
                shutil.copy2(f, dst)
    # 复制根目录下的一些额外文件
    for extra_name in ["llm_server.py", ".env.example", "docker-compose.yml"]:
        extra_src = src_dir / extra_name
        if extra_src.is_file():
            shutil.copy2(extra_src, dest / extra_name)
    meta = {
        "title": default_title, "author": "", "description": src_info.get("description", f"{chapter_count} 章"),
        "source": source_key, "source_path": str(src_dir),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    write_json(dest / "book.json", meta)
    return {"id": book_id, "title": default_title, "source": source_key, "chapter_count": chapter_count, "chapters": list_chapters(book_id)}

# ── 文档导入（拆书第一环：docx/epub/txt → 成书，纯标准库解析）──
ALLOWED_DOC_EXTS = frozenset({'.txt', '.md', '.docx', '.epub'})
MAX_DOC_SIZE = 50 * 1024 * 1024  # 50MB

@app.post("/api/books/import-doc")
async def api_import_doc(file: UploadFile = File(...), title: str = Form("")):
    """上传外部文档 → 解析章节 → 建书。同名校验与 api_import_book 一致（存在则加时间戳）。"""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_DOC_EXTS:
        raise HTTPException(400, f"不支持的文档类型: {ext}（支持 .txt/.md/.docx/.epub；PDF 请先用 calibre 转 epub）")
    content = await file.read()
    if len(content) > MAX_DOC_SIZE:
        raise HTTPException(400, f"文件过大，最大 {MAX_DOC_SIZE//1024//1024}MB")
    import tempfile
    from server.docimport import import_document
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / ("doc" + ext)
        tmp.write_bytes(content)
        try:
            doc_title, chapters, warns = import_document(tmp)
        except (ValueError, KeyError, ET.ParseError, zipfile.BadZipFile) as e:
            raise HTTPException(400, f"文档解析失败：{e}")
    book_title = _clean_title(title) or doc_title or Path(file.filename or "book").stem
    book_id = safe_filename(book_title)
    book_dir = BOOKS_DIR / book_id
    if book_dir.is_dir():
        book_id = book_id + "_" + str(int(time.time()))
        book_dir = BOOKS_DIR / book_id
    for i, ch in enumerate(chapters, 1):
        ch_dir = book_dir / safe_filename(f"{i:02d}-{ch['title']}"[:80])
        ch_dir.mkdir(parents=True, exist_ok=True)
        body = ch["md"].strip()
        (ch_dir / "chapter.md").write_text(f"# {ch['title']}\n\n{body}\n", "utf-8")
    meta = {
        "title": book_title, "author": "", "description": f"文档导入（{file.filename}）· {len(chapters)} 章",
        "source": "import-doc", "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    write_json(book_dir / "book.json", meta)
    return {"id": book_id, "title": book_title, "chapter_count": len(chapters),
            "warnings": warns, "chapters": list_chapters(book_id)}

def _clean_title(t: str) -> str:
    return re.sub(r"\s+", " ", t or "").strip()

# ── 章节 ──
@app.get("/api/books/{book_id}/chapters")
def api_list_chapters(book_id: str):
    return list_chapters(book_id)

@app.get("/api/books/{book_id}/chapters/{chapter_id}")
def api_get_chapter(book_id: str, chapter_id: str):
    md_path = BOOKS_DIR / book_id / chapter_id / "chapter.md"
    if not md_path.is_file():
        raise HTTPException(404, "章节不存在")
    content = md_path.read_text("utf-8")
    title = chapter_id
    if content.strip().startswith("# "):
        title = content.strip().split("\n")[0][2:].strip()
    resources = list_resources(book_id, chapter_id)
    return {"id": chapter_id, "title": title, "content": content, "resources": resources}

@app.put("/api/books/{book_id}/chapters/{chapter_id}")
def api_save_chapter(book_id: str, chapter_id: str, data: dict = Body(...)):
    md_path = BOOKS_DIR / book_id / chapter_id / "chapter.md"
    if not md_path.is_file():
        raise HTTPException(404, "章节不存在")
    if "content" in data:
        md_path.write_text(data["content"], "utf-8")
    if "title" in data:
        # 更新章节标题
        content = md_path.read_text("utf-8")
        lines = content.split("\n")
        if lines and lines[0].startswith("# "):
            lines[0] = "# " + data["title"]
            new_content = "\n".join(lines)
            if content.endswith("\n"):
                new_content += "\n"
            md_path.write_text(new_content, "utf-8")
        # 更新目录名（保留 NN- 数字前缀：过稿书的章节顺序不因改名而乱）
        new_name = safe_filename(data["title"])
        prefix = re.match(r"^(\d{2}-)", md_path.parent.name)
        if prefix:
            new_name = prefix.group(1) + new_name
        new_ch_dir = md_path.parent.parent / new_name
        if not new_ch_dir.exists():
            shutil.move(str(md_path.parent), str(new_ch_dir))
    return {"ok": True}

@app.post("/api/books/{book_id}/chapters/{chapter_id}/status")
def api_set_chapter_status(book_id: str, chapter_id: str, data: dict = Body(...)):
    """过稿状态标记：改写章节头 blockquote 的「状态：xxx」。
    仅对带状态行的章节生效（markbook_sync 导出的过稿书）；「已入管线 <时间戳>」的时间戳尾巴保留不影响解析。"""
    status = str(data.get("status", "")).strip()
    if not status:
        raise HTTPException(400, "缺少 status")
    md_path = BOOKS_DIR / book_id / chapter_id / "chapter.md"
    if not md_path.is_file():
        raise HTTPException(404, "章节不存在")
    content = md_path.read_text("utf-8")
    new_content, n = re.subn(r"状态[：:]\s*[^\s｜|]+", f"状态：{status}", content, count=1)
    if n == 0:
        raise HTTPException(400, "章节无状态行（非过稿书章节）")
    md_path.write_text(new_content, "utf-8")
    return {"ok": True, "status": status}

@app.post("/api/books/{book_id}/chapters")
def api_create_chapter(book_id: str, title: str = Form("新章节")):
    ch_dir = BOOKS_DIR / book_id / safe_filename(title)
    ch_dir.mkdir(parents=True, exist_ok=True)
    md_path = ch_dir / "chapter.md"
    if md_path.is_file():
        raise HTTPException(400, "章节已存在")
    md_path.write_text(f"# {title}\n\n", "utf-8")
    return {"id": ch_dir.name, "title": title}

@app.delete("/api/books/{book_id}/chapters/{chapter_id}")
def api_delete_chapter(book_id: str, chapter_id: str):
    ch_dir = BOOKS_DIR / book_id / chapter_id
    if not ch_dir.is_dir():
        raise HTTPException(404, "章节不存在")
    shutil.rmtree(ch_dir)
    # 连带清理该章节上传资源（此前删除章节会遗留 uploads 孤儿文件）
    upload_dir = UPLOADS_DIR / book_id / chapter_id
    if upload_dir.is_dir():
        shutil.rmtree(upload_dir, ignore_errors=True)
    return {"ok": True}

@app.post("/api/books/{book_id}/chapters/reorder")
def api_reorder_chapters(book_id: str, data: dict = Body(...)):
    """重新排序章节：{order: ["ch_id_1", "ch_id_2", ...]}"""
    order = data.get("order", [])
    if not order:
        raise HTTPException(400, "缺少 order 参数")
    book_dir = BOOKS_DIR / book_id
    # 用编号前缀重命名目录
    for i, ch_id in enumerate(order):
        src = book_dir / ch_id
        if not src.is_dir():
            continue
        prefix = f"{i+1:02d}-"
        new_name = prefix + ch_id.lstrip("0123456789-")
        if ch_id.startswith(tuple(f"{j:02d}-" for j in range(100))):
            new_name = prefix + re.sub(r"^\d+-", "", ch_id, count=1)
        else:
            new_name = prefix + ch_id
        if src.name != new_name:
            dst = book_dir / new_name
            shutil.move(str(src), str(dst))
    return {"ok": True}

# ── 资源上传（类型白名单 + 大小限制）──
ALLOWED_UPLOAD_EXTS = frozenset({'.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.md', '.txt', '.pdf', '.zip', '.mp4', '.webm', '.mp3', '.wav'})
MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50MB

@app.get("/api/books/{book_id}/chapters/{chapter_id}/resources")
def api_list_chapter_resources(book_id: str, chapter_id: str):
    return list_resources(book_id, chapter_id)

@app.post("/api/books/{book_id}/chapters/{chapter_id}/resources")
async def api_upload_resource(book_id: str, chapter_id: str, file: UploadFile = File(...)):
    # 验证文件扩展名
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        return JSONResponse({"error": f"不允许的文件类型: {ext}"}, status_code=400)
    # 验证文件大小
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        return JSONResponse({"error": f"文件过大，最大 {MAX_UPLOAD_SIZE//1024//1024}MB"}, status_code=400)
    upload_dir = UPLOADS_DIR / book_id / chapter_id
    os.makedirs(upload_dir, exist_ok=True)
    path = upload_dir / safe_filename(file.filename or "file")
    path.write_bytes(content)
    return {"name": path.name, "size": len(content), "url": f"/uploads/{book_id}/{chapter_id}/{path.name}"}

@app.delete("/api/books/{book_id}/chapters/{chapter_id}/resources/{filename}")
def api_delete_resource(book_id: str, chapter_id: str, filename: str):
    path = UPLOADS_DIR / book_id / chapter_id / safe_filename(filename)
    if path.is_file():
        path.unlink()
    return {"ok": True}

# ── 搜索 ──
@app.post("/api/books/{book_id}/search")
def api_search(book_id: str, data: dict = Body(...)):
    keyword = data.get("q", "").strip().lower()
    if not keyword:
        return {"results": []}
    results = []
    for ch in list_chapters(book_id):
        md_path = BOOKS_DIR / book_id / ch["id"] / "chapter.md"
        if not md_path.is_file():
            continue
        content = md_path.read_text("utf-8")
        if keyword in content.lower():
            lines = content.split("\n")
            matches = []
            for i, line in enumerate(lines):
                if keyword in line.lower():
                    matches.append({"line": i + 1, "text": line.strip()[:200]})
            results.append({"chapter_id": ch["id"], "chapter_title": ch["title"], "matches": matches})
    return {"results": results}

# ── AI 对话 ──
# MarkBook AI 助教独立配置（与 byoe 分离）
# 端点解析顺序: MARKBOOK_LLM_ENDPOINT > LLM_ENDPOINT > OPENAI_BASE_URL（自动补 /chat/completions）> 默认本地网关
def _resolve_llm_endpoint() -> str:
    ep = os.environ.get("MARKBOOK_LLM_ENDPOINT") or os.environ.get("LLM_ENDPOINT") or ""
    if not ep:
        base = (os.environ.get("OPENAI_BASE_URL") or "").strip().rstrip("/")
        if base:
            ep = base if base.endswith("/chat/completions") else base + "/chat/completions"
    return ep or "http://localhost:8766/v1/chat/completions"

MARKBOOK_LLM_ENDPOINT = _resolve_llm_endpoint()
MARKBOOK_LLM_API_KEY = os.environ.get("MARKBOOK_LLM_API_KEY") or os.environ.get("LLM_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
MARKBOOK_LLM_MODEL = os.environ.get("MARKBOOK_LLM_MODEL") or os.environ.get("BYOE_MODEL", "deepseek-v4-flash")

@app.post("/api/books/{book_id}/chat")
async def api_chat(book_id: str, data: dict = Body(...)):
    messages = data.get("messages", [])
    api_key = data.get("api_key") or MARKBOOK_LLM_API_KEY
    model = data.get("model") or MARKBOOK_LLM_MODEL
    import httpx
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                MARKBOOK_LLM_ENDPOINT,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": messages, "stream": True},
            )
            async def stream():
                async for chunk in response.aiter_lines():
                    if chunk.startswith("data: "):
                        yield chunk + "\n"
                yield "data: [DONE]\n\n"
            return StreamingResponse(stream(), media_type="text/event-stream")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

# ── 代码沙箱（默认关闭，设置 MARKBOOK_SANDBOX_ENABLED=true 开启）──
SANDBOX_ENABLED = os.environ.get("MARKBOOK_SANDBOX_ENABLED", "").lower() in ("1", "true", "yes")
SANDBOX_MAX_OUTPUT = 100 * 1024  # 100KB

@app.post("/api/sandbox/run")
async def api_sandbox_run(data: dict = Body(...)):
    if not SANDBOX_ENABLED:
        return JSONResponse({"output": "代码沙箱已关闭，请设置 MARKBOOK_SANDBOX_ENABLED=true 开启", "returncode": -1})
    code = data.get("code", "")
    files = data.get("files", {})  # {filename: content}
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmpdir:
        for fn, fc in files.items():
            (Path(tmpdir) / safe_filename(fn)).write_text(fc, "utf-8")
        script = Path(tmpdir) / "_run_.py"
        script.write_text(code, "utf-8")
        try:
            result = subprocess.run(
                [sys.executable, str(script)],
                capture_output=True, text=True, timeout=30, cwd=tmpdir,
            )
            output = (result.stdout or "")[:SANDBOX_MAX_OUTPUT]
            if result.stderr:
                stderr = result.stderr[:SANDBOX_MAX_OUTPUT]
                output += "\n--- stderr ---\n" + stderr
            return {"output": output, "returncode": result.returncode}
        except subprocess.TimeoutExpired:
            return {"output": "执行超时（30秒）", "returncode": -1}
        except Exception as e:
            return {"output": f"执行错误: {e}", "returncode": -1}

# ── 静态文件服务 ──
# 注意: 使用自定义 ASGI 包装而非 app.mount("/")，避免覆盖 API 路由
# 将 static 挂到独立前缀，SPA 路由通过 catch-all 处理
from fastapi.responses import FileResponse
import mimetypes

# 独立路由优先于 404 兜底
_reader_html = BASE_DIR / "reader.html"
if _reader_html.is_file():
    @app.get("/reader")
    @app.get("/reader.html")
    async def _reader_page():
        return FileResponse(str(_reader_html))

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

@app.exception_handler(404)
async def _serve_spa_or_404(request, exc):
    """API 路由优先，未匹配的路径尝试返回静态文件"""
    if str(request.url.path).startswith("/api/"):
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "not found"}, status_code=404)
    # 尝试返回静态文件
    path = request.url.path.lstrip("/")
    if not path or path == "":
        path = "index.html"
    file_path = Path(str(BASE_DIR)) / path
    # 安全校验
    file_path = file_path.resolve()
    if not str(file_path).startswith(str(BASE_DIR.resolve())):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if file_path.is_file():
        content_type, _ = mimetypes.guess_type(str(file_path))
        return FileResponse(str(file_path), media_type=content_type or "application/octet-stream")
    # 对于 SPA 路由，返回 index.html（但不是 API 路径）
    if not path.startswith("api/"):
        spa_path = Path(str(BASE_DIR)) / "index.html"
        if spa_path.is_file():
            return FileResponse(str(spa_path))
    from fastapi.responses import JSONResponse
    return JSONResponse({"error": "not found"}, status_code=404)

@app.exception_handler(500)
async def _server_error(request, exc):
    return JSONResponse({"error": "服务器内部错误"}, status_code=500)

# ── 命令行入口 ──
def main():
    parser = argparse.ArgumentParser(description="MarkBook 在线服务")
    parser.add_argument("--port", type=int, default=8765, help="端口（默认 8765）")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    parser.add_argument("--book", type=str, default="", help="导入指定书籍目录（可选）")
    args = parser.parse_args()

    print(f"+{'-'*46}+")
    print(f"|      码客书 (MarkBook) 电子书平台    |")
    print(f"|      电子书写作与发布平台 v2.0           |")
    print(f"+{'-'*46}+")
    print(f"  地址: http://localhost:{args.port}")
    print(f"  API:  http://localhost:{args.port}/api/books")
    print(f"  按 Ctrl+C 停止")

    if args.book:
        print(f"  正在导入书籍源: {args.book} ...")
        from fastapi.testclient import TestClient
        with TestClient(app) as c:
            # 传 source：否则端点默认导入 "book"，--book 参数形同虚设
            resp = c.post("/api/books/import", json={"source": args.book})
            if resp.status_code == 200:
                print(f"  导入完成: {resp.json().get('title', '?')}")
            else:
                print(f"  导入失败: {resp.json().get('detail', '?')}（--book 应为 library/ 下的书源目录名）")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")

if __name__ == "__main__":
    main()