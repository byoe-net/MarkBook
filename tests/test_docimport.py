"""docimport 单测：自造 docx/epub zip fixtures（纯标准库）+ 端到端导入端点。"""
import io
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import docimport  # noqa: E402

DOCX_XML = """<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章 起点风不平</w:t></w:r></w:p>
<w:p><w:r><w:t>正文第一段。夜色像一块浸了油的布。</w:t></w:r></w:p>
<w:p><w:r><w:t>正文第二段。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>小节标题甲</w:t></w:r></w:p>
<w:p><w:r><w:t>小节正文。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第二章 转折</w:t></w:r></w:p>
<w:p><w:r><w:t>第二章正文。</w:t></w:r></w:p>
</w:body></w:document>"""

CORE_XML = """<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>测试之书</dc:title></cp:coreProperties>"""

EPUB_OPF = """<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>EPUB 测试书</dc:title></metadata>
<manifest>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>"""

CONTAINER_XML = """<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"""


def _xhtml(h: str, body: str) -> str:
    return f'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title/></head><body><{h}>' + body + f"</{h}></body></html>"


def _make_docx(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("word/document.xml", DOCX_XML)
        zf.writestr("docProps/core.xml", CORE_XML)


def _make_epub(path: Path) -> None:
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", CONTAINER_XML)
        zf.writestr("OEBPS/content.opf", EPUB_OPF)
        zf.writestr("OEBPS/nav.xhtml", "<html><body><nav/></body></html>")
        zf.writestr("OEBPS/ch1.xhtml", _xhtml("h1", "第一章 风起&#38;云涌") + "")
        # 覆盖写：含段落/引用/图片 alt 的完整章节
        with zipfile.ZipFile(path, "a") as z2:
            pass
    # 重新写完整 ch1/ch2（zipfile 不支持覆盖，直接重建）
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("mimetype", "application/epub+zip")
        zf.writestr("META-INF/container.xml", CONTAINER_XML)
        zf.writestr("OEBPS/content.opf", EPUB_OPF)
        zf.writestr("OEBPS/nav.xhtml", "<html><body><nav/></body></html>")
        zf.writestr("OEBPS/ch1.xhtml",
                    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title/></head><body>'
                    "<h1>第一章 风起云涌</h1><p>段落甲，讲开局。</p>"
                    '<img alt="示意图" src="a.png"/><blockquote><p>金句引用。</p></blockquote>'
                    "</body></html>")
        zf.writestr("OEBPS/ch2.xhtml", _xhtml("h2", "第二章 无大标题"))


class TestDocx(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name) / "book.docx"
        _make_docx(self.p)

    def test_title_and_chapters(self):
        title, chapters, warns = docimport.docx_to_chapters(self.p)
        self.assertEqual(title, "测试之书")
        self.assertEqual([c["title"] for c in chapters], ["第一章 起点风不平", "第二章 转折"])
        self.assertIn("正文第一段。夜色像一块浸了油的布。", chapters[0]["md"])
        self.assertIn("## 小节标题甲", chapters[0]["md"])  # Heading2 → ##，且留在章内
        self.assertIn("第二章正文。", chapters[1]["md"])

    def test_import_document_dispatch(self):
        title, chapters, _ = docimport.import_document(self.p)
        self.assertEqual(title, "测试之书")
        self.assertEqual(len(chapters), 2)


class TestEpub(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.p = Path(self.tmp.name) / "book.epub"
        _make_epub(self.p)

    def test_spine_order_and_nav_skipped(self):
        title, chapters, warns = docimport.epub_to_chapters(self.p)
        self.assertEqual(title, "EPUB 测试书")
        self.assertEqual([c["title"] for c in chapters], ["第一章 风起云涌", "第二章 无大标题"])
        self.assertIn("段落甲，讲开局。", chapters[0]["md"])
        self.assertIn("（图：示意图）", chapters[0]["md"])      # 图片 → alt 占位
        self.assertIn("> 金句引用。", chapters[0]["md"])         # 引用 → > 前缀
        self.assertEqual(warns, [])

    def test_bad_zip_rejected(self):
        bad = self.p.with_suffix(".bad")
        bad.write_bytes(b"not a zip")
        with self.assertRaises(ValueError):
            docimport.epub_to_chapters(bad)


class TestTxt(unittest.TestCase):
    def test_chaptered(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "b.txt"
            p.write_text("第1章 开端\n\n甲。\n\n第2章 相遇\n\n乙。\n", encoding="utf-8")
            title, chapters, _ = docimport.txt_to_chapters(p)
            self.assertEqual([c["title"] for c in chapters], ["第1章 开端", "第2章 相遇"])
            self.assertEqual(chapters[0]["md"], "甲。")

    def test_plain_falls_back_to_single(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "b.txt"
            p.write_text("就一段没有章节结构的文字。\n第二行。", encoding="utf-8")
            _, chapters, _ = docimport.txt_to_chapters(p)
            self.assertEqual(len(chapters), 1)


class TestEndpoint(unittest.TestCase):
    def test_import_doc_creates_book(self):
        from fastapi.testclient import TestClient
        from server import app as m
        with tempfile.TemporaryDirectory() as d:
            tmp = Path(d)
            m.BOOKS_DIR = tmp / "books"
            m.UPLOADS_DIR = tmp / "uploads"
            m.BOOKS_DIR.mkdir()
            m.UPLOADS_DIR.mkdir()
            docx = tmp / "b.docx"
            _make_docx(docx)
            with TestClient(m.app) as c:
                r = c.post("/api/books/import-doc", files={"file": ("我的书.docx", docx.read_bytes())})
                self.assertEqual(r.status_code, 200, r.text)
                data = r.json()
                self.assertEqual(data["chapter_count"], 2)
                self.assertEqual(data["title"], "测试之书")
                ch = (m.BOOKS_DIR / data["id"]).glob("01-*/chapter.md")
                self.assertIn("# 第一章 起点风不平", next(iter(ch)).read_text(encoding="utf-8"))
                # 非法扩展名拒绝
                r2 = c.post("/api/books/import-doc", files={"file": ("x.pdf", b"%PDF")})
                self.assertEqual(r2.status_code, 400)


if __name__ == "__main__":
    unittest.main()
