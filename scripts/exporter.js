/**
 * exporter.js - MarkBook 电子书导出
 * 支持: EPUB, HTML, PDF, DOCX, LaTeX, 静态站点
 */

// ── EPUB 导出（已有，保持） ──────────────────────

async function exportEpub() { /* kept from original */
    const btn = document.getElementById('exportEpubBtn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const zip = new JSZip();
        const now = new Date();
        const bookTitle = project.title || '未命名书籍';
        const author = project.author || '未知作者';
        const bookId = 'urn:uuid:' + (project.id || Date.now());
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
        zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
        const epubCss = `body{font-family:serif;line-height:1.8;margin:5%;text-align:justify}
h1{text-align:center;font-size:1.6em;margin:2em 0 1em}
h2{font-size:1.3em;margin:1.5em 0 0.8em}
pre{background:#f4f4f4;padding:1em;border-radius:4px;white-space:pre-wrap}
code{background:#f4f4f4;padding:0.2em 0.4em}
blockquote{border-left:3px solid #ccc;margin:1em 0;padding-left:1em;color:#666}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:0.5em}img{max-width:100%}`;
        zip.file('OEBPS/style.css', epubCss);
        const chapters = project.chapters;
        const manifestItems = [], spineItems = [];
        const titleHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escXml(bookTitle)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body style="text-align:center;padding:20%"><h1 style="font-size:2em;margin-top:30%">${escXml(bookTitle)}</h1><p style="margin-top:2em;color:#666">${escXml(author)}</p></body></html>`;
        zip.file('OEBPS/title.xhtml', titleHtml);
        manifestItems.push({ id: 'title', href: 'title.xhtml', mediaType: 'application/xhtml+xml' });
        spineItems.push({ idref: 'title' });
        const tocHtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>目录</h1><ol>${chapters.map((ch,i)=>'<li><a href="ch'+i+'.xhtml">'+escXml(ch.title)+'</a></li>').join('\n')}</ol></body></html>`;
        zip.file('OEBPS/toc.xhtml', tocHtml);
        manifestItems.push({ id: 'toc', href: 'toc.xhtml', mediaType: 'application/xhtml+xml' });
        chapters.forEach((ch, i) => {
            const html = mdToEpubHtml(ch.content);
            const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escXml(ch.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${html}</body></html>`;
            zip.file(`OEBPS/ch${i}.xhtml`, xhtml);
            manifestItems.push({ id: `ch${i}`, href: `ch${i}.xhtml`, mediaType: 'application/xhtml+xml' });
            spineItems.push({ idref: `ch${i}` });
        });
        const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata><dc:identifier id="BookId">${bookId}</dc:identifier><dc:title>${escXml(bookTitle)}</dc:title><dc:creator>${escXml(author)}</dc:creator><dc:language>zh-CN</dc:language><dc:date>${now.toISOString()}</dc:date></metadata>
  <manifest>${manifestItems.map(i=>'<item id="'+i.id+'" href="'+i.href+'" media-type="'+i.mediaType+'"/>').join('\n')}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>
  <spine toc="ncx">${spineItems.map(i=>'<itemref idref="'+i.id+'"/>').join('\n')}</spine></package>`;
        zip.file('OEBPS/content.opf', opf);
        const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${bookId}"/><meta name="dtb:depth" content="1"/></head>
  <docTitle><text>${escXml(bookTitle)}</text></docTitle>
  <navMap>${chapters.map((ch,i)=>'<navPoint id="nav_ch'+i+'" playOrder="'+(i+2)+'"><navLabel><text>'+escXml(ch.title)+'</text></navLabel><content src="ch'+i+'.xhtml"/></navPoint>').join('\n')}</navMap></ncx>`;
        zip.file('OEBPS/toc.ncx', ncx);
        const content = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
        saveAs(content, safeName(bookTitle) + '.epub');
        setSaveStatus('EPUB 导出成功');
    } catch (err) { console.error(err); showToast('EPUB 导出失败: ' + err.message, 'error'); }
    finally { btn.innerHTML = originalHTML; btn.disabled = false; }
}

// ── 单文件 HTML 导出（已有，简化） ──────────────

function exportSingleHtml() {
    const bookTitle = project.title || '未命名书籍';
    const author = project.author || '';
    const chapters = project.chapters;
    const tocHtml = chapters.map((ch, i) => `<li><a href="#ch${i}">${escHtml(ch.title)}</a></li>`).join('\n');
    const contentHtml = chapters.map((ch, i) =>
        `<section id="ch${i}" class="chapter"><h1 class="chapter-title">${escHtml(ch.title)}</h1>${mdToEpubHtml(ch.content)}</section>`
    ).join('\n');
    const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escHtml(bookTitle)}</title><style>
body{font-family:serif;line-height:1.8;max-width:800px;margin:0 auto;padding:2em;color:#333}
h1{text-align:center;font-size:1.6em;margin:2em 0 1em}
h2{font-size:1.3em;margin:1.5em 0 0.8em;border-bottom:1px solid #eee;padding-bottom:0.3em}
pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
code{background:#f5f5f5;padding:0.2em 0.4em;border-radius:3px}
blockquote{border-left:3px solid #ddd;margin:1em 0;padding-left:1em;color:#666}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ddd;padding:0.5em}
img{max-width:100%}.chapter{page-break-before:always;margin-top:2em}
.book-header{text-align:center;padding:4em 0 2em}.toc{background:#f9f9f9;padding:1.5em 2em;border-radius:8px;margin:2em 0}
@media print{body{font-size:12pt}.chapter{page-break-before:always}}
</style></head><body>
<div class="book-header"><h1>${escHtml(bookTitle)}</h1>${author ? '<p style="color:#666">' + escHtml(author) + '</p>' : ''}</div>
<div class="toc"><h2>目录</h2><ol>${tocHtml}</ol></div>${contentHtml}</body></html>`;
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    saveAs(blob, safeName(bookTitle) + '.html');
    setSaveStatus('HTML 导出成功');
}

// ── PDF 导出（jsPDF + html2canvas） ──────────────

async function exportPdf() {
    const btn = document.getElementById('exportPdfBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageW = 210, pageH = 297;
        const margin = 15;
        const contentW = pageW - margin * 2;
        const title = project.title || '未命名书籍';
        let pageNum = 1;

        // 封面
        pdf.setFontSize(24);
        pdf.text(title, pageW / 2, pageH / 3, { align: 'center' });
        if (project.author) { pdf.setFontSize(14); pdf.text(project.author, pageW / 2, pageH / 3 + 15, { align: 'center' }); }
        pdf.setFontSize(10); pdf.text('由 MarkBook 生成', pageW / 2, pageH - margin, { align: 'center' });

        // 目录
        pdf.addPage();
        pdf.setFontSize(18); pdf.text('目录', margin, margin + 10);
        project.chapters.forEach((ch, i) => {
            pdf.setFontSize(12);
            pdf.text((i + 1) + '.  ' + ch.title, margin + 5, margin + 20 + i * 8);
        });

        // 各章节
        for (let ci = 0; ci < project.chapters.length; ci++) {
            const ch = project.chapters[ci];
            // 临时渲染到隐藏容器
            const temp = document.createElement('div');
            temp.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;padding:20px;background:white;font-family:serif;line-height:1.8;font-size:14px';
            temp.innerHTML = DOMPurify.sanitize(marked.parse(ch.content));
            document.body.appendChild(temp);

            // 分段截图
            const sections = splitIntoPages(temp, 750); // 每页约 750px 高度
            for (let si = 0; si < sections.length; si++) {
                const sectionDiv = sections[si];
                if (ci > 0 || si > 0 || pageNum > 1) pdf.addPage();
                const canvas = await html2canvas(sectionDiv, {
                    scale: 2, backgroundColor: '#ffffff', logging: false,
                    useCORS: true, allowTaint: true,
                });
                const imgData = canvas.toDataURL('image/jpeg', 0.92);
                const imgW = contentW;
                const imgH = (canvas.height / canvas.width) * contentW;
                pdf.addImage(imgData, 'JPEG', margin, margin, imgW, imgH);
                // 页码
                pdf.setFontSize(8); pdf.setTextColor(150, 150, 150);
                pdf.text('— ' + pageNum + ' —', pageW / 2, pageH - 8, { align: 'center' });
                pageNum++;
            }
            document.body.removeChild(temp);
        }
        pdf.save(safeName(title) + '.pdf');
        setSaveStatus('PDF 导出成功');
    } catch (err) { console.error(err); showToast('PDF 导出失败: ' + err.message, 'error'); }
    finally { btn.innerHTML = '<i class="fas fa-file-pdf"></i>'; btn.disabled = false; }
}

function splitIntoPages(container, maxHeight) {
    const pages = [];
    let currentPage = document.createElement('div');
    let currentH = 0;
    Array.from(container.children).forEach(el => {
        const h = el.offsetHeight || estimateHeight(el);
        if (currentH + h > maxHeight && currentH > 0) {
            pages.push(currentPage);
            currentPage = document.createElement('div');
            currentH = 0;
        }
        currentPage.appendChild(el.cloneNode(true));
        currentH += h;
    });
    if (currentPage.children.length > 0) pages.push(currentPage);
    if (pages.length === 0) { pages.push(document.createElement('div')); }
    return pages;
}

function estimateHeight(el) {
    const tag = el.tagName;
    if (tag === 'H1') return 50;
    if (tag === 'H2') return 40;
    if (tag === 'H3') return 35;
    if (tag === 'P' || tag === 'LI') return 25;
    if (tag === 'PRE') return 80;
    if (tag === 'BLOCKQUOTE') return 40;
    if (tag === 'TABLE') return 60;
    if (tag === 'IMG') return 100;
    if (tag === 'UL' || tag === 'OL') return 30 * (el.children.length || 1);
    if (tag === 'HR') return 10;
    return 20;
}

// ── DOCX 导出（HTML → Word 兼容格式） ────────────

function exportDocx() {
    const btn = document.getElementById('exportDocxBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const title = project.title || '未命名书籍';
        const author = project.author || '';
        let body = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="UTF-8"><title>${escHtml(title)}</title>
<style>body{font-family:serif;font-size:12pt;line-height:1.8}
h1{font-size:18pt;text-align:center;margin:24pt 0 12pt}
h2{font-size:16pt;margin:18pt 0 10pt;border-bottom:1px solid #ccc;padding-bottom:4pt}
h3{font-size:14pt;margin:14pt 0 8pt}
p{text-indent:24pt;margin:6pt 0}
pre{background:#f3f3f3;padding:8pt;font-size:10pt;font-family:monospace}
code{background:#f3f3f3;padding:1pt 3pt;font-size:10pt}
blockquote{border-left:3pt solid #ccc;margin:10pt 0;padding-left:10pt;color:#666}
table{border-collapse:collapse;width:100%;margin:10pt 0}
th,td{border:1pt solid #ccc;padding:4pt 8pt}
img{max-width:100%}
</style></head><body>
<h1 style="margin-top:36pt">${escHtml(title)}</h1>
${author ? '<p style="text-align:center;text-indent:0">' + escHtml(author) + '</p>' : ''}
<hr>`;
        project.chapters.forEach(ch => {
            body += '<h1>' + escHtml(ch.title) + '</h1>';
            body += mdToDocxHtml(ch.content);
        });
        body += '</body></html>';
        const blob = new Blob([body], { type: 'application/msword;charset=utf-8' });
        saveAs(blob, safeName(title) + '.docx');
        setSaveStatus('DOCX 导出成功');
    } catch (err) { console.error(err); showToast('DOCX 导出失败: ' + err.message, 'error'); }
    finally { btn.innerHTML = '<i class="fas fa-file-word"></i>'; btn.disabled = false; }
}

function mdToDocxHtml(md) {
    return DOMPurify.sanitize(marked.parse(md || ''));
}

// ── LaTeX 导出 ────────────────────────────────────

function exportLatex() {
    const btn = document.getElementById('exportLatexBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const title = project.title || '未命名书籍';
        const author = project.author || '作者';
        let tex = `% 由 MarkBook 自动生成
\\documentclass[12pt,a4paper]{ctexbook}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{listings}
\\usepackage{xcolor}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\lstset{basicstyle=\\ttfamily\\small,backgroundcolor=\\color[gray]{0.95},frame=single,breaklines=true}
\\title{${escapeLatex(title)}}
\\author{${escapeLatex(author)}}
\\begin{document}
\\maketitle
\\tableofcontents
`;
        project.chapters.forEach((ch, ci) => {
            tex += `\\chapter{${escapeLatex(ch.title)}}\n`;
            tex += mdToLatex(ch.content);
        });
        tex += '\\end{document}\n';
        const blob = new Blob([tex], { type: 'text/plain;charset=utf-8' });
        saveAs(blob, safeName(title) + '.tex');
        setSaveStatus('LaTeX 导出成功');
    } catch (err) { console.error(err); showToast('LaTeX 导出失败: ' + err.message, 'error'); }
    finally { btn.innerHTML = '<i class="fas fa-file-alt"></i>'; btn.disabled = false; }
}

function mdToLatex(md) {
    if (!md) return '';
    let lines = md.split('\n');
    let out = [];
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('```')) {
            if (inCode) { out.push('\\end{lstlisting}'); inCode = false; }
            else { out.push('\\begin{lstlisting}'); inCode = true; }
            continue;
        }
        if (inCode) { out.push(escapeLatex(line)); continue; }
        if (line.startsWith('# ')) { out.push('\\section{' + escapeLatex(line.substring(2)) + '}'); }
        else if (line.startsWith('## ')) { out.push('\\subsection{' + escapeLatex(line.substring(3)) + '}'); }
        else if (line.startsWith('### ')) { out.push('\\subsubsection{' + escapeLatex(line.substring(4)) + '}'); }
        else if (line.startsWith('> ')) { out.push('\\begin{quote}' + escapeLatex(line.substring(2)) + '\\end{quote}'); }
        else if (line.match(/^- /)) { out.push('\\item ' + escapeLatex(line.substring(2))); }
        else if (line.match(/^\d+\. /)) { out.push('\\item ' + escapeLatex(line.replace(/^\d+\.\s*/, ''))); }
        else if (line.trim() === '---' || line.trim() === '***') { out.push('\\medskip\\hrule\\medskip'); }
        else if (line.trim() === '') { out.push(''); }
        else { out.push(escapeLatex(line) + '\\par'); }
    }
    if (inCode) out.push('\\end{lstlisting}');
    return out.join('\n');
}

function escapeLatex(str) {
    return String(str).replace(/[&%$#_{}~^\\]/g, function (m) {
        const map = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
        return map[m] || m;
    });
}

// ── 静态站点导出 ──────────────────────────────────

async function exportSite() {
    const btn = document.getElementById('exportSiteBtn');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    btn.disabled = true;
    try {
        const zip = new JSZip();
        const title = project.title || '未命名书籍';
        const author = project.author || '';
        const chapters = project.chapters;

        // CSS
        const siteCss = `body{font-family:"Noto Serif CJK SC",Georgia,serif;line-height:1.8;max-width:800px;margin:0 auto;padding:2em;color:#333}
h1{font-size:1.6em;margin:2em 0 1em;text-align:center}
h2{font-size:1.3em;margin:1.5em 0 0.8em;border-bottom:1px solid #eee;padding-bottom:0.3em}
pre{background:#f5f5f5;padding:1em;border-radius:4px;overflow-x:auto}
code{background:#f5f5f5;padding:0.2em 0.4em;border-radius:3px}
blockquote{border-left:3px solid #ddd;margin:1em 0;padding-left:1em;color:#666}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ddd;padding:0.5em}
img{max-width:100%}
nav{background:#f8f9fa;padding:1em;border-radius:8px;margin-bottom:2em;display:flex;gap:1em;flex-wrap:wrap}
nav a{color:#2563eb;text-decoration:none}
nav a:hover{text-decoration:underline}
nav .active{font-weight:bold;color:#1d4ed8}
nav .title{font-weight:bold;color:#333;margin-right:auto}
.footer{text-align:center;color:#999;font-size:0.9em;margin-top:4em;padding-top:2em;border-top:1px solid #eee}`;
        zip.file('style.css', siteCss);

        // 各章节 HTML
        chapters.forEach((ch, i) => {
            const prev = i > 0 ? `<a href="ch${i-1}.html">← ${chapters[i-1].title}</a>` : '';
            const next = i < chapters.length - 1 ? `<a href="ch${i+1}.html">${chapters[i+1].title} →</a>` : '';
            const nav = `<nav><span class="title">${escXml(title)}</span>${prev}${next}${i > 0 ? `<a href="index.html">目录</a>` : ''}</nav>`;
            const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escXml(ch.title)} - ${escXml(title)}</title><link rel="stylesheet" href="style.css"></head><body>
${nav}
<h1>${escXml(ch.title)}</h1>
${mdToEpubHtml(ch.content)}
<div class="footer">${escXml(title)}${author ? ' — ' + escXml(author) : ''}</div>
</body></html>`;
            zip.file(`ch${i}.html`, html);
        });

        // 首页（目录）
        const tocItems = chapters.map((ch, i) => `<li><a href="ch${i}.html">${escXml(ch.title)}</a></li>`).join('\n');
        const indexHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escXml(title)}</title><link rel="stylesheet" href="style.css"></head><body>
<h1 style="margin-top:3em">${escXml(title)}</h1>
${author ? '<p style="text-align:center;color:#666">' + escXml(author) + '</p>' : ''}
<ol style="max-width:500px;margin:2em auto">${tocItems}</ol>
<div class="footer">由 MarkBook 生成</div>
</body></html>`;
        zip.file('index.html', indexHtml);

        // 下载
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, safeName(title) + '-site.zip');
        setSaveStatus('静态站点导出成功');
    } catch (err) { console.error(err); showToast('站点导出失败: ' + err.message, 'error'); }
    finally { btn.innerHTML = '<i class="fas fa-globe"></i>'; btn.disabled = false; }
}

// ── 工具函数 ──────────────────────────────────────

function mdToEpubHtml(md) {
    let html = DOMPurify.sanitize(marked.parse(md || ''));
    const temp = document.createElement('div');
    temp.innerHTML = html;
    temp.querySelectorAll('pre code').forEach(block => { block.innerHTML = escXml(block.innerHTML); });
    return temp.innerHTML;
}

function escXml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escHtml(str) {
    const d = document.createElement('div'); d.textContent = str; return d.innerHTML;
}

function safeName(str) {
    return String(str).replace(/[/\\?%*:|"<>]/g, '_');
}

// ── 微信排版导出 ──────────────────────────────────

function exportWechat() {
    if (!project || !project.chapters.length) { showToast('没有可导出的内容', 'warning'); return; }

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function mdToWechatHtml(md, title) {
        var h = '<section style="padding:10px 15px;font-size:16px;line-height:1.75;color:#333;font-family:-apple-system,BlinkMacSystemFont,Helvetica Neue,PingFang SC,Microsoft YaHei,Source Han Sans SC,Noto Sans CJK SC,sans-serif;word-wrap:break-word">';
        if (title) h += '<h1 style="font-size:22px;font-weight:700;text-align:center;margin:20px 0 15px;color:#222;line-height:1.4">' + esc(title) + '</h1>';
        // 简单预处理：按行渲染
        var lines = md.split('\n');
        var inCode = false; var codeBuf = [];
        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            // 代码块
            if (/^```/.test(line)) {
                if (inCode) {
                    h += '<pre style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:4px;padding:12px 16px;overflow-x:auto;font-size:14px;line-height:1.5;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace;white-space:pre-wrap;word-wrap:break-word;color:#24292e"><code style="background:transparent;padding:0;font-size:inherit">' + esc(codeBuf.join('\n')) + '</code></pre>';
                    codeBuf = []; inCode = false;
                } else { inCode = true; }
                continue;
            }
            if (inCode) { codeBuf.push(line); continue; }

            // 跳过空行
            if (!line.trim()) { continue; }

            // 标题
            var hMatch = line.match(/^(#{1,6})\s+(.+)/);
            if (hMatch) {
                var lev = hMatch[1].length;
                var sizes = {1:'22px',2:'19px',3:'17px',4:'16px',5:'15px',6:'14px'};
                var margins = {1:'20px 0 12px',2:'16px 0 10px',3:'14px 0 8px',4:'12px 0 6px',5:'10px 0 6px',6:'10px 0 6px'};
                h += '<h' + lev + ' style="font-size:' + (sizes[lev]||'16px') + ';font-weight:700;margin:' + (margins[lev]||'10px 0') + ';color:#222;line-height:1.4">' + esc(hMatch[2]) + '</h' + lev + '>';
                continue;
            }

            // 水平线
            if (/^---/.test(line) || /^\*\*\*/.test(line)) {
                h += '<hr style="border:none;border-top:1px solid #e1e4e8;margin:20px 0">';
                continue;
            }

            // 引用
            if (/^>\s/.test(line)) {
                var qText = line.replace(/^>\s?/, '');
                h += '<blockquote style="border-left:3px solid #3b82f6;margin:12px 0;padding:8px 12px;color:#555;background:#f0f7ff;border-radius:2px">' + esc(qText) + '</blockquote>';
                continue;
            }

            // 无序列表
            if (/^[-*+]\s/.test(line)) {
                var liText = line.replace(/^[-*+]\s/, '');
                h += '<p style="margin:4px 0;padding-left:1.2em;text-indent:-1.2em;color:#333">• ' + esc(liText) + '</p>';
                continue;
            }

            // 有序列表
            var olMatch = line.match(/^(\d+)\.\s(.+)/);
            if (olMatch) {
                h += '<p style="margin:4px 0;padding-left:1.8em;text-indent:-1.8em;color:#333">' + olMatch[1] + '. ' + esc(olMatch[2]) + '</p>';
                continue;
            }

            // 图片
            var imgMatch = line.match(/!\[(.*?)\]\((.*?)\)/);
            if (imgMatch && line.trim() === imgMatch[0]) {
                h += '<p style="text-align:center;margin:12px 0"><img src="' + esc(imgMatch[2]) + '" alt="' + esc(imgMatch[1]) + '" style="max-width:100%;border-radius:4px;display:block;margin:0 auto"></p>';
                continue;
            }

            // 行内格式化处理 + 段落
            var p = esc(line);
            p = p.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:700">$1</strong>');
            p = p.replace(/\*(.+?)\*/g, '<em>$1</em>');
            p = p.replace(/`(.+?)`/g, '<code style="background:#f0f0f0;padding:2px 5px;border-radius:3px;font-size:14px;font-family:monospace;color:#d63384">$1</code>');
            p = p.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#3b82f6;text-decoration:none">$1</a>');
            h += '<p style="margin:8px 0;color:#333;text-indent:0">' + p + '</p>';
        }
        if (inCode && codeBuf.length) {
            h += '<pre style="background:#f6f8fa;border:1px solid #e1e4e8;border-radius:4px;padding:12px 16px;overflow-x:auto;font-size:14px;line-height:1.5;font-family:SFMono-Regular,Consolas,Liberation Mono,Menlo,monospace;white-space:pre-wrap;word-wrap:break-word;color:#24292e"><code style="background:transparent;padding:0;font-size:inherit">' + esc(codeBuf.join('\n')) + '</code></pre>';
        }
        h += '</section>';
        return h;
    }

    // 生成完整 HTML（含所有章节）
    var fullHtml = '<section style="max-width:100%;background:#fff">';
    for (var j = 0; j < project.chapters.length; j++) {
        var ch = project.chapters[j];
        fullHtml += mdToWechatHtml(ch.content, ch.title);
        if (j < project.chapters.length - 1) {
            fullHtml += '<hr style="border:none;border-top:2px solid #e1e4e8;margin:30px 20px">';
        }
    }
    fullHtml += '</section>';

    // 复制到剪贴板
    var blob = new Blob([fullHtml], { type: 'text/html' });
    var clipboardItem = new ClipboardItem({ 'text/html': blob });
    navigator.clipboard.write([clipboardItem]).then(function () {
        setSaveStatus('微信排版已复制，可直接粘贴到公众号后台');
    }).catch(function () {
        // fallback: 用 textarea 复制纯文本版
        var ta = document.createElement('textarea');
        ta.value = fullHtml.replace(/<[^>]+>/g, '');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setSaveStatus('微信排版已复制（纯文本版）');
    });

    // 预览弹窗
    var win = window.open('', '_blank', 'width=400,height=700,scrollbars=yes');
    if (win) {
        win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=375"><title>微信排版预览</title></head><body style="margin:0;background:#f5f5f5;display:flex;justify-content:center">');
        win.document.write('<div style="width:375px;background:#fff;min-height:100vh">');
        win.document.write(fullHtml);
        win.document.write('</div></body></html>');
        win.document.close();
    }
}

// ── 初始化 ────────────────────────────────────────

function initExporter() {
    document.getElementById('exportEpubBtn').addEventListener('click', exportEpub);
    document.getElementById('exportHtmlBtn').addEventListener('click', exportSingleHtml);
    document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
    document.getElementById('exportDocxBtn').addEventListener('click', exportDocx);
    document.getElementById('exportLatexBtn').addEventListener('click', exportLatex);
    document.getElementById('exportSiteBtn').addEventListener('click', exportSite);
    var wechatBtn = document.getElementById('exportWechatBtn');
    if (wechatBtn) wechatBtn.addEventListener('click', exportWechat);
}
