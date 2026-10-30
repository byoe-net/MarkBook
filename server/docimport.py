"""server/docimport.py — 外部文档 → Markdown 章节（纯标准库：txt / docx / epub）。

拆书线第一环：任意电子文档导入码客书成书，章节按标题层级切分，正文转 Markdown。
不引第三方依赖：docx = zip + word/document.xml（OOXML），epub = zip + OPF + XHTML，
均用标准库 zipfile / xml.etree / html.parser 解析。
PDF 需要重依赖（pypdf）且排版抽取质量不稳，不在零依赖支持面——请先用 calibre 转 epub。

约定：
  import_document(path) -> (书标题, [{"title": 章标题, "md": 不含 H1 的正文}], 警告列表)
  章节正文用 ## 起头的小节；图片以（图：alt）占位（导入不抽取媒体文件）。
"""
from __future__ import annotations

import posixpath
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_DC = "{http://purl.org/dc/elements/1.1/}"
_EPUB_CONTAINER = "META-INF/container.xml"
_CN_CH = "零一二三四五六七八九十百千万〇两"


def _clean(text: str) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", text or "").strip()


# ── DOCX ──────────────────────────────────────────────────

def _docx_title(zf: zipfile.ZipFile) -> str:
    try:
        root = ET.fromstring(zf.read("docProps/core.xml"))
        for tag in (f"{_DC}title", "title"):
            el = root.find(f".//{tag}") or root.find(tag)
            if el is not None and _clean(el.text or ""):
                return _clean(el.text)
    except (KeyError, ET.ParseError):
        pass
    return ""


def _docx_paragraphs(zf: zipfile.ZipFile) -> list[tuple[int, str]]:
    """[(级别 0=正文 1..6=标题, 文本)]；style 名（含中文 Word 的「标题 N」）与 outlineLvl 双识别。"""
    root = ET.fromstring(zf.read("word/document.xml"))
    out: list[tuple[int, str]] = []
    for p in root.iter(f"{W}p"):
        text = _clean("".join(t.text or "" for t in p.iter(f"{W}t")))
        if not text:
            continue
        level = 0
        style = p.find(f"{W}pPr/{W}pStyle")
        val = (style.get(f"{W}val", "") if style is not None else "") or ""
        m = re.match(r"(?i)^(?:heading|标题)\s*([1-9])$", val.strip())
        if m:
            level = int(m.group(1))
        else:
            outl = p.find(f"{W}pPr/{W}outlineLvl")
            if outl is not None:
                try:
                    level = int(outl.get(f"{W}val", "9")) + 1
                except ValueError:
                    level = 0
        out.append((min(level, 6), text))
    return out


def docx_to_chapters(path: Path) -> tuple[str, list[dict], list[str]]:
    with zipfile.ZipFile(path) as zf:
        title = _docx_title(zf)
        paras = _docx_paragraphs(zf)
    warns: list[str] = []
    has_h1 = any(h == 1 for h, _ in paras)
    if not has_h1:
        body = "\n\n".join(t if h == 0 else "#" * h + " " + t for h, t in paras)
        return title or path.stem, [{"title": "全文", "md": body}], warns
    chapters: list[dict] = []
    body: list[str] = []
    for h, t in paras:
        if h == 1:
            if body:  # 归还给上一章（任何 h1 之前的正文才是「前文」）
                if chapters:
                    chapters[-1]["md"] = "\n\n".join(body)
                else:
                    chapters.append({"title": "前文", "md": "\n\n".join(body)})
                body = []
            chapters.append({"title": t, "md": ""})
        else:
            body.append("#" * h + " " + t if h > 0 else t)
    if body:
        if chapters:
            chapters[-1]["md"] = "\n\n".join(body)
        else:
            chapters.append({"title": "全文", "md": "\n\n".join(body)})
    return title or (chapters[0]["title"] if chapters else path.stem), chapters, warns


# ── EPUB ──────────────────────────────────────────────────

class _HTML2MD(HTMLParser):
    """XHTML → Markdown 行（正文级转换：标题/段落/引用/列表项/图片 alt 占位）。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.buf: list[str] = []
        self.h: int = 0
        self.quote = 0
        self.title = ""

    def _flush(self, prefix: str = "") -> None:
        text = _clean("".join(self.buf))
        self.buf = []
        if text:
            self.lines.append(prefix + text)

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush()
            self.h = int(tag[1])
        elif tag == "p":
            self._flush()
        elif tag == "blockquote":
            self._flush()
            self.quote += 1
        elif tag in ("li", "br", "tr", "div", "section"):
            self._flush()
        elif tag == "img":
            alt = _clean(d.get("alt", ""))
            if alt:
                self.buf.append(f"（图：{alt}）")

    def handle_endtag(self, tag):
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6") and self.h:
            text = _clean("".join(self.buf))
            self.buf = []
            if text:
                self.lines.append("#" * self.h + " " + text)
                if not self.title and self.h <= 2:
                    self.title = text
            self.h = 0
        elif tag == "p":
            self._flush("> " * self.quote)
        elif tag == "blockquote":
            self._flush("> " * self.quote)
            self.quote = max(0, self.quote - 1)
        elif tag in ("li", "pre"):
            self._flush("> " * self.quote)

    def handle_data(self, data):
        self.buf.append(data)


def _xhtml_to_md(raw: bytes) -> tuple[str, str]:
    p = _HTML2MD()
    p.feed(raw.decode("utf-8", errors="replace"))
    p.close()
    p._flush()
    return p.title, "\n\n".join(p.lines)


def epub_to_chapters(path: Path) -> tuple[str, list[dict], list[str]]:
    warns: list[str] = []
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile as e:
        raise ValueError(f"无法打开（非 zip 文档）：{e}")
    with zf:
        names = set(zf.namelist())
        if _EPUB_CONTAINER not in names:
            raise ValueError("缺少 META-INF/container.xml（不是合法 EPUB）")
        croot = ET.fromstring(zf.read(_EPUB_CONTAINER))
        rootfile = croot.find(".//{*}rootfile")
        if rootfile is None:
            raise ValueError("container.xml 无 rootfile")
        opf_path = rootfile.get("full-path", "")
        if opf_path not in names:
            raise ValueError(f"OPF 不在包内：{opf_path}")
        opf_dir = posixpath.dirname(opf_path)
        oroot = ET.fromstring(zf.read(opf_path))
        title = _clean(oroot.findtext(f".//{_DC}title") or "")
        href_by_id: dict[str, str] = {}
        for item in oroot.iter("{http://www.idpf.org/2007/opf}item"):
            href_by_id[item.get("id", "")] = (item.get("properties", "") or "", item.get("href", ""))
        docs: list[str] = []
        for ref in oroot.iter("{http://www.idpf.org/2007/opf}itemref"):
            props, href = href_by_id.get(ref.get("idref", ""), ("", ""))
            if not href or "nav" in props:
                continue
            full = posixpath.normpath(posixpath.join(opf_dir, href))
            if full in names:
                docs.append(full)
        if not docs:  # 无 spine（罕见）→ 抓所有 xhtml 兜底
            docs = sorted(n for n in names if n.lower().endswith((".xhtml", ".html")))
            warns.append("OPF 无 spine，按包内 XHTML 顺序导入")
        chapters: list[dict] = []
        for i, full in enumerate(docs, 1):
            if "cover" in posixpath.basename(full).lower():
                continue
            ch_title, md = _xhtml_to_md(zf.read(full))
            if not md:
                continue
            if not ch_title:
                ch_title = f"第{i}章"
            lines = md.split("\n")
            if lines and lines[0].startswith("# ") and lines[0][2:] == ch_title:
                lines = lines[1:]
            chapters.append({"title": ch_title, "md": "\n".join(lines).strip()})
    return title or path.stem, chapters, warns


# ── TXT / Markdown ────────────────────────────────────────

_CH_SPLIT = re.compile(
    rf"(?m)^[ \t]*(第[{_CN_CH}0-9]{{1,7}}[章节回卷集][^\n]*|Chapter\s+\d+[^\n]*|(?:#{{1,2}})\s*\S.*)[ \t]*$")


def txt_to_chapters(path: Path) -> tuple[str, list[dict], list[str]]:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gbk", errors="replace")
    lines = text.splitlines()
    marks = [(m.start(), m.group(1)) for m in _CH_SPLIT.finditer(text)]
    chapters: list[dict] = []
    if len(marks) < 2:  # 无章节结构 → 整本一章
        title = _clean(lines[0].lstrip("# ")) if lines and lines[0].startswith("#") else path.stem
        return title or path.stem, [{"title": title or "全文", "md": text.strip()}], []
    head = text[:marks[0][0]].strip()
    if head:
        chapters.append({"title": "前言", "md": head})
    for i, (pos, mark) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        body = text[pos:end].strip()
        m_title = mark.lstrip("# ").strip()
        lines_body = body.split("\n")
        if lines_body and lines_body[0].strip() == mark.strip():
            lines_body = lines_body[1:]
        chapters.append({"title": m_title, "md": "\n".join(lines_body).strip()})
    title = _clean(lines[0].lstrip("# ")) if lines and lines[0].startswith("#") else path.stem
    return title or path.stem, chapters, []


def import_document(path: Path) -> tuple[str, list[dict], list[str]]:
    ext = path.suffix.lower()
    if ext == ".docx":
        return docx_to_chapters(path)
    if ext == ".epub":
        return epub_to_chapters(path)
    if ext in (".txt", ".md"):
        return txt_to_chapters(path)
    raise ValueError(f"不支持的文档类型：{ext}（支持 .txt/.md/.docx/.epub；PDF 请先用 calibre 转 epub）")
