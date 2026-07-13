/**
 * main.js - MarkBook 核心编辑器
 * 实时预览、工具栏、快捷键、深色模式、TTS、演示模式等
 */

var editor = document.getElementById('editor');
var preview = document.getElementById('preview');
var copyBtn = document.getElementById('copyBtn');
var copyHtmlBtn = document.getElementById('copyHtmlBtn');
var generatePdfBtn = document.getElementById('generatePdfBtn');
var generateImageBtn = document.getElementById('generateImageBtn');
var settingsPanel = document.getElementById('settingsPanel');
var closeSettingsBtn = document.getElementById('closeSettingsBtn');
var overlay = document.getElementById('overlay');
var resetSettingsBtn = document.getElementById('resetSettings');
var watermarkTextInput = document.getElementById('watermarkText');
var lineNumbersEl = document.getElementById('lineNumbers');
var saveMdBtn = document.getElementById('saveMdBtn');
var darkModeBtn = document.getElementById('darkModeBtn');
var wordCountEl = document.getElementById('wordCount');
var charCountEl = document.getElementById('charCount');
var readTimeEl = document.getElementById('readTime');

// ── Marked 渲染器 ──
var renderer = new marked.Renderer();
var defaultTextRenderer = renderer.text.bind(renderer);
renderer.text = function (text) {
    return defaultTextRenderer(text.replace(/===(.*?)===|==(.*?)==/g, '<mark>$1$2</mark>'));
};
renderer.heading = function (text, level) {
    var ch = getCurrentChapter();
    var prefix = (ch && ch.id) ? ch.id + '-' : '';
    var slug = text.toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '').replace(/-+/g, '-');
    return '<h' + level + ' id="' + prefix + slug + '">' + text + '</h' + level + '>';
};
marked.setOptions({ breaks: true, gfm: true, renderer: renderer });

try { mermaid.initialize({ startOnLoad: false }); } catch (e) {}

// 全局引用（由高亮模块注册）
var _applyHighlightsFn = null;
var _applyAnnotationsFn = null;
function applyHighlightsToPreview(chapterId) { if (_applyHighlightsFn) _applyHighlightsFn(chapterId); }
function applyAnnotationsToPreview(chapterId) { if (_applyAnnotationsFn) _applyAnnotationsFn(chapterId); }

// ── 渲染 ──
function renderPreview(content) {
    preview.innerHTML = DOMPurify.sanitize(marked.parse(content || ''));
    preview.querySelectorAll('pre code').forEach(function (block) {
        if (block.textContent.trim().startsWith('mermaid')) return;
        try { hljs.highlightElement(block); } catch (e) {}
    });
    try {
        renderMathInElement(preview, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true },
            ], throwOnError: false,
        });
    } catch (e) {}
    var mermaidIndex = 0;
    preview.querySelectorAll('pre code.language-mermaid').forEach(function (block) {
        var pre = block.parentElement;
        var div = document.createElement('div');
        div.className = 'mermaid';
        div.id = 'mermaid-' + (mermaidIndex++);
        div.textContent = block.textContent;
        pre.parentNode.replaceChild(div, pre);
    });
    try { mermaid.run({ nodes: preview.querySelectorAll('.mermaid') }); } catch (e) {}
    // 重绘高亮+批注（通过全局函数）
    var ch = getCurrentChapter();
    if (ch) {
        applyHighlightsToPreview(ch.id);
        applyAnnotationsToPreview(ch.id);
    }
    // 添加标题锚点
    preview.querySelectorAll('h1, h2, h3, h4').forEach(function (h) {
        if (h.querySelector('.heading-anchor')) return;
        var a = document.createElement('a');
        a.className = 'heading-anchor ml-1 text-gray-300 hover:text-blue-500 no-underline cursor-pointer';
        a.innerHTML = '<i class="fas fa-link text-xs"></i>';
        a.title = '复制链接到此标题';
        a.onclick = function (e) {
            e.stopPropagation();
            var url = location.href.split('#')[0] + '#' + h.id;
            navigator.clipboard.writeText(url).then(function () {
                a.innerHTML = '<i class="fas fa-check text-xs"></i>';
                a.style.color = '#22c55e';
                setTimeout(function () { a.innerHTML = '<i class="fas fa-link text-xs"></i>'; a.style.color = ''; }, 1500);
            }).catch(function () { prompt('复制此链接:', url); });
        };
        h.appendChild(a);
    });
}

// ── 代码沙箱运行按钮 ──
function addSandboxButtons() {
    preview.querySelectorAll('pre code.language-python').forEach(function (block) {
        var pre = block.parentElement;
        if (pre.querySelector('.sandbox-btn')) return;
        var wrapper = document.createElement('div');
        wrapper.className = 'sandbox-wrapper';
        var btn = document.createElement('button');
        btn.className = 'sandbox-btn text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600';
        btn.innerHTML = '<i class="fas fa-play"></i> 运行';
        var output = document.createElement('pre');
        output.className = 'sandbox-output hidden';
        btn.onclick = function () {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 运行中...';
            output.classList.remove('hidden');
            output.textContent = '执行中...';
            fetch('/api/sandbox/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: block.textContent })
            }).then(function (r) { return r.json(); }).then(function (data) {
                output.textContent = data.output || '(无输出)';
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> 运行';
            }).catch(function (err) {
                output.textContent = '请求失败: ' + err.message;
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-play"></i> 运行';
            });
        };
        wrapper.appendChild(btn);
        wrapper.appendChild(output);
        pre.parentNode.insertBefore(wrapper, pre.nextSibling);
    });
}

// ── 字数统计 ──
function updateWordCount() {
    var text = editor.value;
    var chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var englishWords = (text.match(/[a-zA-Z]+/g) || []).length;
    var count = chineseChars + englishWords;
    var chars = text.replace(/\s/g, '').length;
    var readTime = Math.max(1, Math.ceil(count / 300));
    wordCountEl.textContent = count + ' 字';
    charCountEl.textContent = chars + ' 字符';
    readTimeEl.textContent = '约 ' + readTime + ' 分钟';
}

var debouncedWordCount = (function () {
    var timer;
    return function () { clearTimeout(timer); timer = setTimeout(updateWordCount, 200); };
})();

function updateLineNumbers() {
    var lineCount = editor.value.split('\n').length;
    lineNumbersEl.innerHTML = Array.from({ length: lineCount }, function (_, i) { return i + 1; }).join('\n');
}

var _renderTimer;
editor.addEventListener('input', function () {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(function () {
        renderPreview(editor.value);
        updateLineNumbers();
        clearHighlights();
        debouncedWordCount();
    }, 30);
    updateLineNumbers();
    clearHighlights();
    debouncedWordCount();
});

// ── 文件拖放 ──
editor.addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('drag-over'); });
editor.addEventListener('dragleave', function (e) { e.preventDefault(); this.classList.remove('drag-over'); });
editor.addEventListener('drop', function (e) {
    e.preventDefault(); this.classList.remove('drag-over');
    var files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.md')) {
        var reader = new FileReader();
        reader.onload = function (ev) {
            editor.value = ev.target.result;
            renderPreview(ev.target.result);
            updateLineNumbers();
            updateWordCount();
        };
        reader.readAsText(files[0]);
    }
    handleImageDrop(e);
});

// ── 图片粘贴/拖放 ──
function handleImagePaste(items) {
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
            var file = items[i].getAsFile();
            if (!file) continue;
            uploadAndInsertImage(file);
            break;
        }
    }
}

function handleImageDrop(e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || files.length === 0) return;
    for (var i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) { uploadAndInsertImage(files[i]); break; }
    }
}

async function uploadAndInsertImage(file) {
    var imgMd = '\n![' + (file.name.replace(/\.[^.]+$/, '') || 'image') + '](uploading...)\n';
    var start = editor.selectionStart;
    editor.value = editor.value.substring(0, start) + imgMd + editor.value.substring(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + imgMd.length;
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    if (window.currentBookId) {
        try {
            var form = new FormData();
            form.append('file', file);
            var resp = await fetch(serverBaseUrl + '/api/books/' + window.currentBookId + '/chapters/' + (window.getCurrentChapter()?.id || '') + '/resources', { method: 'POST', body: form });
            var data = await resp.json();
            if (data.url) {
                editor.value = editor.value.replace('](uploading...)', '](' + data.url + ')');
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch (e) {
            // fallback: 用 DataURL
            var reader = new FileReader();
            reader.onload = function (ev) {
                editor.value = editor.value.replace('](uploading...)', '](' + ev.target.result + ')');
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            };
            reader.readAsDataURL(file);
        }
    } else {
        var reader = new FileReader();
        reader.onload = function (ev) {
            editor.value = editor.value.replace('](uploading...)', '](' + ev.target.result + ')');
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        };
        reader.readAsDataURL(file);
    }
}

editor.addEventListener('paste', function (e) {
    handleImagePaste(e.clipboardData && e.clipboardData.items);
});

// ── Tab 键 ──
editor.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    var start = this.selectionStart;
    this.value = this.value.substring(0, start) + '    ' + this.value.substring(this.selectionEnd);
    this.selectionStart = this.selectionEnd = start + 4;
});

// ── 保存 .md 文件 ──
saveMdBtn.addEventListener('click', function () {
    var content = editor.value;
    if (!content.trim()) return;
    var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = getDocTitle('chapter') + '.md';
    a.click();
    URL.revokeObjectURL(url);
});

// ── 复制 ──
copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(editor.value).then(function () {
        copyBtn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(function () { copyBtn.innerHTML = '<i class="fas fa-copy"></i>'; }, 1000);
    });
});

copyHtmlBtn.addEventListener('click', function () {
    var html = preview.innerHTML;
    navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([preview.innerText], { type: 'text/plain' })
    })]).then(function () {
        copyHtmlBtn.innerHTML = '<i class="fas fa-check mr-1"></i>已复制';
        setTimeout(function () { copyHtmlBtn.innerHTML = '<i class="fas fa-copy mr-1"></i>复制'; }, 1000);
    }).catch(function () { copyHtmlBtn.innerHTML = '<i class="fas fa-times mr-1"></i>失败'; });
});

// ── PDF ──
generatePdfBtn.addEventListener('click', function () {
    var originalTitle = document.title;
    document.title = getDocTitle('MarkBook');
    window.print();
    document.title = originalTitle;
});

// ── 图片导出设置 ──
var DEFAULT_IMAGE_SETTINGS = { backgroundColor: '#ffffff', borderStyle: 'simple', watermarkText: '由 MarkBook 生成' };
var imageSettings = Object.assign({}, DEFAULT_IMAGE_SETTINGS);

function loadSettings() {
    try {
        var saved = localStorage.getItem('markbook-settings');
        if (saved) Object.keys(DEFAULT_IMAGE_SETTINGS).forEach(function (k) {
            var p = JSON.parse(saved);
            if (k in p) imageSettings[k] = p[k];
        });
    } catch (e) {}
}

function saveSettings() { localStorage.setItem('markbook-settings', JSON.stringify(imageSettings)); }

function updateSettingsUI() {
    document.querySelectorAll('.color-option').forEach(function (opt) { opt.classList.toggle('selected', opt.dataset.color === imageSettings.backgroundColor); });
    document.querySelectorAll('[data-border-style]').forEach(function (btn) { btn.classList.toggle('selected', btn.dataset.borderStyle === imageSettings.borderStyle); });
    watermarkTextInput.value = imageSettings.watermarkText;
}

function showSettings() { settingsPanel.classList.remove('hidden'); overlay.classList.remove('hidden'); }
function hideSettings() { settingsPanel.classList.add('hidden'); overlay.classList.add('hidden'); }

document.getElementById('settingsBtn').addEventListener('click', showSettings);
closeSettingsBtn.addEventListener('click', hideSettings);
overlay.addEventListener('click', hideSettings);

document.querySelectorAll('.color-option').forEach(function (el) {
    el.addEventListener('click', function () {
        document.querySelectorAll('.color-option').forEach(function (e) { e.classList.remove('selected'); });
        this.classList.add('selected');
        imageSettings.backgroundColor = this.dataset.color;
        saveSettings();
    });
});
document.querySelectorAll('[data-border-style]').forEach(function (el) {
    el.addEventListener('click', function () {
        document.querySelectorAll('[data-border-style]').forEach(function (e) { e.classList.remove('selected'); });
        this.classList.add('selected');
        imageSettings.borderStyle = this.dataset.borderStyle;
        saveSettings();
    });
});
watermarkTextInput.addEventListener('input', function () { imageSettings.watermarkText = this.value; saveSettings(); });
resetSettingsBtn.addEventListener('click', function () {
    Object.assign(imageSettings, DEFAULT_IMAGE_SETTINGS);
    updateSettingsUI();
    saveSettings();
});
loadSettings();
updateSettingsUI();

function isColorDark(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 160;
}

function createImageWrapper() {
    var bc = imageSettings.backgroundColor, bs = imageSettings.borderStyle;
    var w = document.createElement('div');
    w.style.cssText = 'position:fixed;left:-9999px;background:' + bc + ';width:600px;padding:20px;' + (bs === 'shadow' ? 'box-shadow:0 0 20px rgba(0,0,0,0.1);' : '') + 'border-radius:12px;';
    var f = document.createElement('div');
    f.style.cssText = 'border:4px solid #000;border-radius:16px;padding:16px;background:white;position:relative;overflow:hidden;';
    var c = document.createElement('div');
    c.className = 'markdown-preview';
    c.innerHTML = preview.innerHTML;
    f.appendChild(c);
    w.appendChild(f);
    var m = document.createElement('div');
    m.style.cssText = 'text-align:center;color:' + (isColorDark(bc) ? '#fff' : '#9CA3AF') + ';font-size:12px;margin-top:16px;opacity:0.8;';
    m.textContent = imageSettings.watermarkText;
    w.appendChild(m);
    return w;
}

generateImageBtn.addEventListener('click', async function () {
    var orig = this.innerHTML;
    this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
    this.disabled = true;
    var wrapper = createImageWrapper();
    document.body.appendChild(wrapper);
    try {
        await new Promise(function (r) { setTimeout(r, 100); });
        var canvas = await html2canvas(wrapper, { scale: 3, backgroundColor: imageSettings.backgroundColor, logging: false, useCORS: true, allowTaint: true, letterRendering: true });
        var link = document.createElement('a');
        link.download = getDocTitle('markdown') + '.png';
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();
    } catch (e) {
        console.error('图片生成失败:', e);
        this.innerHTML = '<i class="fas fa-times"></i> 失败';
        setTimeout(function () { this.innerHTML = orig; this.disabled = false; }.bind(this), 2000);
        document.body.removeChild(wrapper);
        return;
    }
    document.body.removeChild(wrapper);
    this.innerHTML = orig;
    this.disabled = false;
});

// ── 选中同步 ──
var lastHighlight = null;
function clearHighlights() { lastHighlight = null; }

function levenshteinDistance(s1, s2) {
    var m = s1.length, n = s2.length;
    if (m === 0) return n; if (n === 0) return m;
    if (m * n > 2500) return Math.abs(m - n);
    var dp = Array.from({ length: m + 1 }, function () { return Array(n + 1).fill(0); });
    for (var i = 0; i <= m; i++) dp[i][0] = i;
    for (var j = 0; j <= n; j++) dp[0][j] = j;
    for (var i = 1; i <= m; i++) for (var j = 1; j <= n; j++) dp[i][j] = s1[i - 1] === s2[j - 1] ? dp[i - 1][j - 1] : Math.min(dp[i - 1][j - 1] + 1, dp[i - 1][j] + 1, dp[i][j - 1] + 1);
    return dp[m][n];
}

function highlightInPreview(searchText) {
    if (!searchText.trim()) { clearHighlights(); return; }
    var contextStart = Math.max(0, editor.selectionStart - 20);
    var contextEnd = Math.min(editor.value.length, editor.selectionEnd + 20);
    var context = editor.value.substring(contextStart, contextEnd);
    renderPreview(editor.value);
    var textContent = preview.textContent || '';
    var bestIndex = -1, bestDist = Infinity;
    var si = 0;
    while ((si = textContent.indexOf(searchText, si)) !== -1) {
        var mc = textContent.substring(Math.max(0, si - 20), Math.min(textContent.length, si + searchText.length + 20));
        var d = levenshteinDistance(context, mc);
        if (d < bestDist) { bestDist = d; bestIndex = si; }
        si += 1;
    }
    if (bestIndex !== -1) {
        var ci = 0;
        var walk = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walk.nextNode())) {
            var nl = node.textContent.length;
            if (ci <= bestIndex && bestIndex < ci + nl) {
                try {
                    var range = document.createRange();
                    var span = document.createElement('span');
                    span.className = 'highlight-text';
                    range.setStart(node, bestIndex - ci);
                    range.setEnd(node, Math.min(bestIndex - ci + searchText.length, nl));
                    range.surroundContents(span);
                } catch (e) {}
                break;
            }
            ci += nl;
        }
    }
    lastHighlight = searchText;
}

editor.addEventListener('mouseup', function () { highlightInPreview(this.value.substring(this.selectionStart, this.selectionEnd)); });
editor.addEventListener('keyup', function (e) {
    if (['Shift', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) highlightInPreview(this.value.substring(this.selectionStart, this.selectionEnd));
});
preview.addEventListener('mouseup', function () {
    var sel = window.getSelection().toString();
    if (!sel) return;
    var idx = editor.value.indexOf(sel);
    if (idx !== -1) editor.setSelectionRange(idx, idx + sel.length);
});

// ── 同步滚动 ──
var isEditorScrolling = false, isPreviewScrolling = false;
editor.addEventListener('scroll', function () {
    if (isPreviewScrolling) return;
    isEditorScrolling = true;
    var pct = editor.scrollTop / (editor.scrollHeight - editor.clientHeight);
    preview.scrollTop = pct * (preview.scrollHeight - preview.clientHeight);
    lineNumbersEl.scrollTop = editor.scrollTop;
    setTimeout(function () { isEditorScrolling = false; }, 50);
});
preview.addEventListener('scroll', function () {
    if (isEditorScrolling) return;
    isPreviewScrolling = true;
    var pct = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    editor.scrollTop = pct * (editor.scrollHeight - editor.clientHeight);
    setTimeout(function () { isPreviewScrolling = false; }, 50);
});

// ── 工具栏 ──
var MARKDOWN_TEMPLATES = {
    heading: function (t) { return '### ' + (t || '标题'); },
    bold: function (t) { return '**' + (t || '粗体') + '**'; },
    italic: function (t) { return '*' + (t || '斜体') + '*'; },
    highlight: function (t) { return '===' + (t || '高亮') + '==='; },
    link: function (t) { return t ? '[' + t + '](url)' : '[链接文本](url)'; },
    image: function () { return '![图片描述](图片链接)'; },
    code: function (t) { return '```\n' + (t || '代码') + '\n```'; },
    quote: function (t) { return '> ' + (t || '引用'); },
    'list-ul': function () { return '- 列表项 1\n- 列表项 2'; },
    'list-ol': function () { return '1. 列表项 1\n2. 列表项 2'; },
};
function insertMarkdown(type) {
    var sel = editor.value.substring(editor.selectionStart, editor.selectionEnd);
    var tmpl = MARKDOWN_TEMPLATES[type];
    if (!tmpl) return;
    var text = tmpl(sel);
    var start = editor.selectionStart;
    editor.value = editor.value.substring(0, start) + text + editor.value.substring(editor.selectionEnd);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    editor.focus();
    editor.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 's') { e.preventDefault(); document.getElementById('saveMdBtn').click(); return; }
    if (e.key === '/') { e.preventDefault(); document.getElementById('shortcutsModal').classList.remove('hidden'); return; }
    var map = { b: 'bold', i: 'italic', k: 'link', h: 'heading' };
    if (map[e.key.toLowerCase()]) { e.preventDefault(); insertMarkdown(map[e.key.toLowerCase()]); }
});

// ── 深色模式 ──
function initDarkMode() {
    var saved = localStorage.getItem('markbook-darkMode');
    var prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var isDark = saved === 'true' || (saved === null && prefers);
    if (isDark) { document.body.classList.add('dark'); updateDarkIcon(true); updateHljsTheme(true); }
}
function toggleDarkMode() {
    var isDark = document.body.classList.toggle('dark');
    localStorage.setItem('markbook-darkMode', isDark);
    updateDarkIcon(isDark);
    updateHljsTheme(isDark);
}
function updateDarkIcon(isDark) { darkModeBtn.querySelector('i').className = isDark ? 'fas fa-sun' : 'fas fa-moon'; }
function updateHljsTheme(isDark) {
    var t = document.getElementById('hljs-dark');
    if (t) t.media = isDark ? 'all' : '(prefers-color-scheme: dark)';
}
initDarkMode();
darkModeBtn.addEventListener('click', toggleDarkMode);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (localStorage.getItem('markbook-darkMode') === null) {
        document.body.classList.toggle('dark', e.matches);
        updateDarkIcon(e.matches);
    }
});

// ── 预览切换 ──
var previewToggle = document.getElementById('previewToggle');
var previewPanel = document.getElementById('previewPanel');
var editorPanel = document.getElementById('editorPanel');
function togglePreview() {
    var hidden = previewPanel.classList.toggle('panel-hidden');
    localStorage.setItem('markbook-previewHidden', hidden);
    var icon = previewToggle.querySelector('i');
    icon.className = hidden ? 'fas fa-eye-slash' : 'fas fa-eye';
    previewToggle.title = hidden ? '显示预览' : '隐藏预览';
}
(function () {
    var saved = localStorage.getItem('markbook-previewHidden');
    if (saved === 'true') { previewPanel.classList.add('panel-hidden'); previewToggle.querySelector('i').className = 'fas fa-eye-slash'; previewToggle.title = '显示预览'; }
})();
previewToggle.addEventListener('click', togglePreview);

// ── 分栏拖拽 ──
(function () {
    var divider = document.getElementById('splitDivider');
    var container = document.getElementById('splitContainer');
    var isDragging = false;
    function getX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function startDrag(e) { if (window.innerWidth <= 640) return; isDragging = true; divider.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); }
    function moveDrag(e) {
        if (!isDragging) return;
        var rect = container.getBoundingClientRect();
        var pct = ((getX(e) - rect.left) / rect.width) * 100;
        pct = Math.max(15, Math.min(85, pct));
        editorPanel.style.flex = '1 1 ' + pct + '%';
        previewPanel.style.flex = '1 1 ' + (100 - pct) + '%';
        e.preventDefault();
    }
    function stopDrag() { if (!isDragging) return; isDragging = false; divider.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; }
    divider.addEventListener('mousedown', startDrag);
    divider.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', moveDrag);
    document.addEventListener('touchmove', moveDrag, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
})();

// ── 全屏预览 ──
(function () {
    var fsBtn = document.getElementById('fullscreenPreviewBtn');
    var fsOverlay = document.getElementById('previewFullscreen');
    var fsContent = document.getElementById('previewFullscreenContent');
    var closeBtn = document.getElementById('closeFullscreenBtn');
    fsBtn.addEventListener('click', function () { fsContent.innerHTML = preview.innerHTML; fsOverlay.classList.remove('hidden'); });
    closeBtn.addEventListener('click', function () { fsOverlay.classList.add('hidden'); });
    fsOverlay.addEventListener('click', function (e) { if (e.target === fsOverlay) fsOverlay.classList.add('hidden'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !fsOverlay.classList.contains('hidden')) fsOverlay.classList.add('hidden'); });
})();

// ── 书签 ──
(function () {
    var btn = document.getElementById('bookmarkBtn');
    var section = document.getElementById('bookmarkSection');
    var list = document.getElementById('bookmarkList');
    function getBookmarks() { try { return JSON.parse(localStorage.getItem('markbook-bookmarks') || '[]'); } catch (e) { return []; } }
    function saveBookmarks(bms) { localStorage.setItem('markbook-bookmarks', JSON.stringify(bms)); }
    function renderBookmarkList() {
        var bms = getBookmarks();
        if (bms.length === 0) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');
        list.innerHTML = '';
        bms.forEach(function (bm, idx) {
            var div = document.createElement('div');
            div.className = 'flex items-start gap-1 px-2 py-1 text-xs hover:bg-gray-100 rounded cursor-pointer group';
            var textSpan = document.createElement('span');
            textSpan.className = 'flex-1 truncate text-gray-600';
            textSpan.textContent = bm.label || bm.chapterTitle + '…';
            textSpan.onclick = function () { var c = (window.project || {}).chapters.find(function (x) { return x.id === bm.chapterId; }); if (c) switchChapter(bm.chapterId); };
            var delBtn = document.createElement('button');
            delBtn.innerHTML = '<i class="fas fa-times text-gray-400 hover:text-red-500"></i>';
            delBtn.className = 'opacity-0 group-hover:opacity-100';
            delBtn.onclick = function (e) { e.stopPropagation(); bms.splice(idx, 1); saveBookmarks(bms); renderBookmarkList(); };
            div.appendChild(textSpan);
            div.appendChild(delBtn);
            list.appendChild(div);
        });
    }
    btn.addEventListener('click', function () {
        var ch = getCurrentChapter();
        if (!ch) return;
        var previewText = preview.innerText.substring(0, 60).replace(/\s+/g, ' ').trim();
        var bms = getBookmarks();
        bms.push({ chapterId: ch.id, chapterTitle: ch.title, label: previewText, timestamp: Date.now() });
        saveBookmarks(bms);
        renderBookmarkList();
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(function () { btn.innerHTML = '<i class="fas fa-star"></i>'; }, 1000);
    });
    renderBookmarkList();
    var origSwitch = switchChapter;
    switchChapter = function (id) { origSwitch(id); list.querySelectorAll('div').forEach(function (div) { div.classList.remove('bg-yellow-50'); }); };
})();

// ── 快捷键面板 ──
(function () {
    var modal = document.getElementById('shortcutsModal');
    var btn = document.getElementById('shortcutsBtn');
    var close = document.getElementById('closeShortcutsBtn');
    btn.addEventListener('click', function () { modal.classList.remove('hidden'); });
    close.addEventListener('click', function () { modal.classList.add('hidden'); });
    modal.addEventListener('click', function (e) { if (e.target === modal) modal.classList.add('hidden'); });
})();

// ── 高亮 + 批注 ──
(function () {
    var STORAGE_KEY_H = 'markbook-highlights';
    var STORAGE_KEY_A = 'markbook-annotations';
    var toolbar = document.getElementById('highlightToolbar');
    var popup = document.getElementById('annotationPopup');
    var currentSel = null;

    function getHighlights() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_H) || '{}'); } catch (e) { return {}; } }
    function saveHighlights(h) { localStorage.setItem(STORAGE_KEY_H, JSON.stringify(h)); }
    function getAnnotations() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY_A) || '{}'); } catch (e) { return {}; } }
    function saveAnnotations(a) { localStorage.setItem(STORAGE_KEY_A, JSON.stringify(a)); }

    // 注册到全局，供 renderPreview 调用
    _applyHighlightsFn = function(chapterId) {
        if (!chapterId) return;
        var hls = getHighlights(); var list = hls[chapterId] || [];
        if (list.length === 0) return;
        var walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null, false);
        var node, matches = [];
        while ((node = walker.nextNode())) {
            var text = node.textContent;
            list.forEach(function (h) { var idx = text.indexOf(h.text); if (idx !== -1) matches.push({ node: node, start: idx, end: idx + h.text.length, color: h.color, text: h.text }); });
        }
        matches.sort(function (a, b) { return b.start - a.start; });
        matches.forEach(function (m) {
            if (!m.node.parentNode) return;
            var range = document.createRange(); range.setStart(m.node, m.start); range.setEnd(m.node, m.end);
            var mark = document.createElement('mark');
            mark.className = 'mark-highlight'; mark.style.backgroundColor = m.color; mark.style.borderBottom = '2px solid ' + m.color;
            try { range.surroundContents(mark); } catch (e) {}
        });
    };

    _applyAnnotationsFn = function(chapterId) {
        if (!chapterId) return;
        var anns = getAnnotations(); var list = anns[chapterId] || [];
        if (list.length === 0) return;
        var walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            list.forEach(function (a) {
                var idx = node.textContent.indexOf(a.text); if (idx === -1) return;
                var range = document.createRange(); range.setStart(node, idx + a.text.length); range.setEnd(node, idx + a.text.length);
                var span = document.createElement('sup'); span.className = 'annotation-indicator'; span.title = a.note;
                span.onclick = function () { alert('批注: ' + a.note); };
                try { range.insertNode(span); } catch (e) {}
            });
        }
    };

    preview.addEventListener('mouseup', function (e) {
        var sel = window.getSelection();
        var text = sel.toString().trim();
        if (!text || text.length > 500) { toolbar.classList.add('hidden'); return; }
        var range = sel.getRangeAt(0);
        if (!preview.contains(range.commonAncestorContainer)) { toolbar.classList.add('hidden'); return; }
        currentSel = { text: text, range: range, node: range.commonAncestorContainer };
        window._lastSelText = text;
        var rect = range.getBoundingClientRect();
        toolbar.style.left = Math.max(8, rect.left + rect.width / 2 - 80) + 'px';
        toolbar.style.top = (rect.top - 48) + 'px';
        toolbar.classList.remove('hidden');
    });
    document.addEventListener('mousedown', function (e) {
        if (!toolbar.contains(e.target) && !popup.contains(e.target)) { toolbar.classList.add('hidden'); if (!popup.classList.contains('hidden') && !e.target.closest('#annotationPopup')) popup.classList.add('hidden'); }
    });

    toolbar.querySelectorAll('[data-color]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (!currentSel) return;
            var color = this.dataset.color;
            var ch = getCurrentChapter();
            if (!ch) return;
            var hls = getHighlights();
            if (!hls[ch.id]) hls[ch.id] = [];
            if (hls[ch.id].some(function (h) { return h.text === currentSel.text; })) { toolbar.classList.add('hidden'); return; }
            hls[ch.id].push({ text: currentSel.text, color: color, timestamp: Date.now() });
            saveHighlights(hls);
            applyHighlightsToPreview(ch.id);
            toolbar.classList.add('hidden');
        });
    });

    document.getElementById('highlightRemoveBtn').addEventListener('click', function () {
        if (!currentSel) return;
        var ch = getCurrentChapter(); if (!ch) return;
        var hls = getHighlights(); if (!hls[ch.id]) return;
        hls[ch.id] = hls[ch.id].filter(function (h) { return h.text !== currentSel.text; });
        if (hls[ch.id].length === 0) delete hls[ch.id];
        saveHighlights(hls); applyHighlightsToPreview(ch.id); toolbar.classList.add('hidden');
    });

    document.getElementById('highlightAnnotateBtn').addEventListener('click', function () {
        if (!currentSel) return;
        var rect = currentSel.range.getBoundingClientRect();
        popup.style.left = Math.max(8, rect.left) + 'px';
        popup.style.top = (rect.bottom + 8) + 'px';
        document.getElementById('annotationInput').value = '';
        document.getElementById('annotationInput').focus();
        popup.classList.remove('hidden');
        toolbar.classList.add('hidden');
    });
    document.getElementById('annotationCancelBtn').addEventListener('click', function () { popup.classList.add('hidden'); });
    document.getElementById('annotationSaveBtn').addEventListener('click', function () {
        if (!currentSel) return;
        var note = document.getElementById('annotationInput').value.trim();
        if (!note) return;
        var ch = getCurrentChapter(); if (!ch) return;
        var anns = getAnnotations();
        if (!anns[ch.id]) anns[ch.id] = [];
        anns[ch.id].push({ text: currentSel.text, note: note, timestamp: Date.now() });
        saveAnnotations(anns); applyAnnotationsToPreview(ch.id); popup.classList.add('hidden');
    });

    // 移除旧的 renderPreview 覆盖（改为由全局函数调用）
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'h') { e.preventDefault(); toolbar.classList.toggle('hidden'); }
    });
})();

// ── 演示模式 ──
(function () {
    var btn = document.getElementById('presentBtn');
    var overlay = document.getElementById('presentOverlay');
    var slideDiv = document.getElementById('presentSlide');
    var info = document.getElementById('presentSlideInfo');
    var progress = document.getElementById('presentProgress');
    var exitBtn = document.getElementById('presentExitBtn');
    var slides = [];
    var current = 0;

    function buildSlides(html) {
        var div = document.createElement('div'); div.innerHTML = html;
        var parts = []; var currentSlide = [];
        Array.from(div.children).forEach(function (el) {
            var tag = el.tagName;
            if ((tag === 'H1' || tag === 'H2') && currentSlide.length > 0) { parts.push(currentSlide); currentSlide = []; }
            currentSlide.push(el);
        });
        if (currentSlide.length > 0) parts.push(currentSlide);
        if (parts.length === 0) parts.push(currentSlide);
        return parts;
    }

    function renderSlide(idx) {
        if (slides.length === 0) { slideDiv.innerHTML = '<p style="text-align:center;color:#9ca3af;margin-top:20%;">无内容</p>'; return; }
        if (idx < 0) idx = 0; if (idx >= slides.length) idx = slides.length - 1;
        current = idx;
        var fragment = document.createDocumentFragment();
        slides[idx].forEach(function (el) { fragment.appendChild(el.cloneNode(true)); });
        slideDiv.innerHTML = ''; slideDiv.appendChild(fragment);
        info.textContent = (current + 1) + ' / ' + slides.length;
        progress.style.width = ((current + 1) / slides.length * 100) + '%';
    }

    btn.addEventListener('click', function () {
        slides = buildSlides(preview.innerHTML); current = 0; renderSlide(0); overlay.classList.remove('hidden');
    });
    exitBtn.addEventListener('click', function () { overlay.classList.add('hidden'); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.classList.add('hidden'); });
    document.addEventListener('keydown', function (e) {
        if (overlay.classList.contains('hidden')) return;
        if (e.key === 'Escape') { overlay.classList.add('hidden'); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); if (current < slides.length - 1) renderSlide(current + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (current > 0) renderSlide(current - 1); }
    });
})();

// ── 聚焦模式 ──
(function () {
    var btn = document.getElementById('focusBtn');
    btn.addEventListener('click', function () {
        var on = document.body.classList.toggle('focus-mode');
        btn.classList.toggle('bg-blue-100', on); btn.classList.toggle('text-blue-600', on);
        btn.title = on ? '退出聚焦模式' : '聚焦模式';
    });
})();

// ── 打字机模式 ──
(function () {
    var btn = document.getElementById('typewriterBtn');
    btn.addEventListener('click', function () {
        var on = document.body.classList.toggle('typewriter-mode');
        btn.classList.toggle('bg-blue-100', on); btn.classList.toggle('text-blue-600', on);
        btn.title = on ? '退出打字机模式' : '打字机模式';
    });
    editor.addEventListener('input', function () {
        if (!document.body.classList.contains('typewriter-mode')) return;
        var lineHeight = 1.5 * 14;
        var lines = editor.value.substring(0, editor.selectionStart).split('\n').length;
        var target = (lines - 1) * lineHeight - editor.clientHeight / 2 + lineHeight / 2;
        editor.scrollTop = Math.max(0, target);
    });
    editor.addEventListener('click', function () {
        if (document.body.classList.contains('typewriter-mode')) editor.dispatchEvent(new Event('input'));
    });
})();

// ── TTS 朗读 ──
(function () {
    if (!window.speechSynthesis) return;
    var btn = document.getElementById('ttsBtn');
    var bar = document.getElementById('ttsBar');
    var playBtn = document.getElementById('ttsPlayBtn');
    var stopBtn = document.getElementById('ttsStopBtn');
    var rateInput = document.getElementById('ttsRate');
    var statusEl = document.getElementById('ttsStatus');
    var utterance = null, isPlaying = false, chunks = [], chunkIndex = 0, highlightMark = null;

    function getTextChunks() {
        var text = preview.innerText;
        var paragraphs = text.split(/\n\s*\n/);
        var result = [];
        paragraphs.forEach(function (p) {
            p = p.trim(); if (!p) return;
            if (p.length > 200) { var sentences = p.split(/(?<=[。！？.!?])/); sentences.forEach(function (s) { s = s.trim(); if (s) result.push(s); }); }
            else result.push(p);
        });
        return result;
    }

    function highlightChunk(idx) {
        if (highlightMark) { var p = highlightMark.parentNode; if (p) { while (highlightMark.firstChild) p.insertBefore(highlightMark.firstChild, highlightMark); p.removeChild(highlightMark); } highlightMark = null; }
        if (idx < 0 || idx >= chunks.length) return;
        var searchText = chunks[idx].substring(0, 40);
        var walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, null, false);
        var node;
        while ((node = walker.nextNode())) {
            var pos = node.textContent.indexOf(searchText); if (pos === -1) continue;
            try { var range = document.createRange(); range.setStart(node, pos); range.setEnd(node, Math.min(pos + chunks[idx].length, node.textContent.length)); highlightMark = document.createElement('mark'); highlightMark.style.backgroundColor = '#fde68a'; highlightMark.style.transition = 'background 0.3s'; range.surroundContents(highlightMark); highlightMark.scrollIntoView({ behavior: 'smooth', block: 'center' }); break; } catch (e) { break; }
        }
    }

    function speakChunk() {
        if (chunkIndex >= chunks.length) { statusEl.textContent = '朗读完成'; isPlaying = false; playBtn.innerHTML = '<i class="fas fa-play"></i>'; return; }
        utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
        utterance.rate = parseFloat(rateInput.value); utterance.lang = 'zh-CN';
        highlightChunk(chunkIndex);
        utterance.onend = function () { chunkIndex++; if (isPlaying) speakChunk(); };
        utterance.onerror = function () { statusEl.textContent = '朗读出错'; isPlaying = false; playBtn.innerHTML = '<i class="fas fa-play"></i>'; };
        speechSynthesis.speak(utterance);
        statusEl.textContent = (chunkIndex + 1) + ' / ' + chunks.length;
    }

    btn.addEventListener('click', function () {
        if (isPlaying) { speechSynthesis.cancel(); isPlaying = false; playBtn.innerHTML = '<i class="fas fa-play"></i>'; bar.classList.add('hidden'); if (highlightMark) { var p = highlightMark.parentNode; if (p) { while (highlightMark.firstChild) p.insertBefore(highlightMark.firstChild, highlightMark); p.removeChild(highlightMark); } highlightMark = null; } return; }
        chunks = getTextChunks(); if (chunks.length === 0) { statusEl.textContent = '无内容可朗读'; return; }
        chunkIndex = 0; isPlaying = true; bar.classList.remove('hidden'); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; speakChunk();
    });
    playBtn.addEventListener('click', function () {
        if (isPlaying) { speechSynthesis.pause(); isPlaying = false; playBtn.innerHTML = '<i class="fas fa-play"></i>'; statusEl.textContent = '已暂停'; }
        else if (speechSynthesis.paused) { speechSynthesis.resume(); isPlaying = true; playBtn.innerHTML = '<i class="fas fa-pause"></i>'; statusEl.textContent = (chunkIndex + 1) + ' / ' + chunks.length; }
        else if (chunks.length > 0) { isPlaying = true; playBtn.innerHTML = '<i class="fas fa-pause"></i>'; speakChunk(); }
    });
    stopBtn.addEventListener('click', function () { speechSynthesis.cancel(); isPlaying = false; playBtn.innerHTML = '<i class="fas fa-play"></i>'; chunkIndex = chunks.length; statusEl.textContent = '已停止'; if (highlightMark) { var p = highlightMark.parentNode; if (p) { while (highlightMark.firstChild) p.insertBefore(highlightMark.firstChild, highlightMark); p.removeChild(highlightMark); } highlightMark = null; } });
    rateInput.addEventListener('input', function () { if (utterance && isPlaying) utterance.rate = parseFloat(this.value); });
})();

// ── 搜索 ──
(function () {
    var btn = document.getElementById('searchBtn');
    var bar = document.getElementById('searchBar');
    var input = document.getElementById('searchInput');
    var resultsEl = document.getElementById('searchResults');
    var closeBtn = document.getElementById('searchCloseBtn');
    if (!btn || !bar || !input) return;

    btn.addEventListener('click', function () {
        var hidden = bar.classList.toggle('hidden');
        if (!hidden) { input.focus(); resultsEl.classList.remove('hidden'); }
        else resultsEl.classList.add('hidden');
        resultsEl.innerHTML = '';
    });
    if (closeBtn) closeBtn.addEventListener('click', function () { bar.classList.add('hidden'); resultsEl.classList.add('hidden'); resultsEl.innerHTML = ''; });

    var _searchTimer;
    input.addEventListener('input', function () {
        clearTimeout(_searchTimer);
        var q = this.value.trim();
        if (!q) { resultsEl.innerHTML = ''; resultsEl.classList.add('hidden'); return; }
        resultsEl.classList.remove('hidden');
        _searchTimer = setTimeout(async function () {
            resultsEl.innerHTML = '<div class="text-xs text-gray-400 p-2">搜索中...</div>';
            var results = await searchBook(q);
            if (!results || results.length === 0) { resultsEl.innerHTML = '<div class="text-xs text-gray-400 p-2">无结果</div>'; return; }
            resultsEl.innerHTML = '';
            results.forEach(function (r) {
                var div = document.createElement('div');
                div.className = 'px-3 py-2 text-xs hover:bg-gray-100 cursor-pointer border-b border-gray-50 flex items-start gap-2';
                div.innerHTML = '<i class="fas fa-file-alt text-gray-400 mt-0.5"></i><div><div class="font-medium text-blue-600">' + (r.chapter_title || r.chapter_id) + '</div>' +
                    (r.matches && r.matches[0] ? '<div class="text-gray-500 truncate mt-0.5">' + (r.matches[0].text || '').substring(0, 140) + '</div>' : '') + '</div>';
                div.onclick = function () { switchChapter(r.chapter_id); bar.classList.add('hidden'); resultsEl.classList.add('hidden'); };
                resultsEl.appendChild(div);
            });
        }, 300);
    });
    document.addEventListener('click', function (e) {
        if (!bar.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            bar.classList.add('hidden'); resultsEl.classList.add('hidden');
        }
    });
})();

// ── 排版设置 ──
(function () {
    var btn = document.getElementById('typesetBtn');
    var panel = document.getElementById('typesetPanel');
    var closeBtn = document.getElementById('closeTypesetBtn');
    var overlay = document.getElementById('overlay');
    if (!btn || !panel) return;

    btn.addEventListener('click', function () { panel.classList.remove('hidden'); overlay.classList.remove('hidden'); });
    closeBtn.addEventListener('click', function () { panel.classList.add('hidden'); overlay.classList.add('hidden'); });

    function applyTypeset() {
        var fontSize = document.getElementById('tsFontSize').value;
        var lineHeight = document.getElementById('tsLineHeight').value;
        var maxWidth = document.getElementById('tsMaxWidth').value;
        var codeSize = document.getElementById('tsCodeSize').value;
        var indent = document.getElementById('tsIndent').checked;
        var justify = document.getElementById('tsJustify').checked;
        var preview = document.getElementById('preview');
        preview.style.fontSize = fontSize + 'px';
        preview.style.lineHeight = lineHeight;
        preview.style.maxWidth = maxWidth;
        preview.querySelectorAll('pre code').forEach(function (b) { b.style.fontSize = codeSize; });
        preview.style.textIndent = indent ? '2em' : '0';
        preview.style.textAlign = justify ? 'justify' : 'left';
        var settings = { fontSize: fontSize, lineHeight: lineHeight, maxWidth: maxWidth, codeSize: codeSize, indent: indent, justify: justify };
        localStorage.setItem('markbook-typeset', JSON.stringify(settings));
    }

    function loadTypeset() {
        try {
            var saved = JSON.parse(localStorage.getItem('markbook-typeset') || '{}');
            if (saved.fontSize) document.getElementById('tsFontSize').value = saved.fontSize;
            if (saved.lineHeight) document.getElementById('tsLineHeight').value = saved.lineHeight;
            if (saved.maxWidth) document.getElementById('tsMaxWidth').value = saved.maxWidth;
            if (saved.codeSize) document.getElementById('tsCodeSize').value = saved.codeSize;
            if (saved.indent) document.getElementById('tsIndent').checked = saved.indent;
            if (saved.justify) document.getElementById('tsJustify').checked = saved.justify;
        } catch (e) {}
        applyTypeset();
    }

    document.querySelectorAll('#typesetPanel select, #typesetPanel input').forEach(function(el) {
        el.addEventListener('change', applyTypeset);
    });
    loadTypeset();
})();

// ── AI 助教对话 ──
(function () {
    var panel = document.getElementById('aiChatPanel');
    var messagesEl = document.getElementById('aiChatMessages');
    var inputEl = document.getElementById('aiChatInput');
    var sendBtn = document.getElementById('aiChatSendBtn');
    var contextEl = document.getElementById('aiChatContext');
    var closeBtn = document.getElementById('closeAiChatBtn');
    var aiChatBtn = document.getElementById('aiChatBtn');
    var highlightAiBtn = document.getElementById('highlightAiBtn');
    var promptBtns = document.querySelectorAll('.ai-prompt-btn');
    if (!panel || !messagesEl || !inputEl || !sendBtn) return;

    var chatHistory = [];

    function addMessage(role, content) {
        chatHistory.push({ role: role, content: content });
        var div = document.createElement('div');
        div.className = role === 'user' ? 'text-right' : 'text-left';
        div.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs ' +
            (role === 'user' ? 'bg-purple-500 text-white rounded-br-sm' : 'bg-gray-100 text-gray-700 rounded-bl-sm') + '">' +
            content.replace(/\n/g, '<br>') + '</div>';
        messagesEl.appendChild(div);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showPanel(contextText) {
        panel.classList.remove('hidden');
        if (contextText) {
            contextEl.textContent = '引用: ' + contextText.substring(0, 200);
            contextEl.classList.remove('hidden');
            contextEl.dataset.context = contextText;
        } else {
            contextEl.classList.add('hidden');
            contextEl.dataset.context = '';
        }
        inputEl.focus();
    }

    function hidePanel() {
        panel.classList.add('hidden');
    }

    aiChatBtn.addEventListener('click', function () {
        if (!panel.classList.contains('hidden')) { hidePanel(); return; }
        var sel = editor.value.substring(editor.selectionStart, editor.selectionEnd).trim();
        if (!sel) sel = window._lastSelText || '';
        showPanel(sel);
    });

    if (highlightAiBtn) {
        highlightAiBtn.addEventListener('click', function () {
            var sel = window._lastSelText || window.getSelection().toString().trim() || '';
            showPanel(sel);
            document.getElementById('highlightToolbar').classList.add('hidden');
        });
    }

    closeBtn.addEventListener('click', hidePanel);

    function sendMessage(text) {
        if (!text.trim()) return;
        addMessage('user', text);
        inputEl.value = '';

        var thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'text-left';
        thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-700 rounded-bl-sm"><i class="fas fa-spinner fa-spin"></i> 思考中...</div>';
        messagesEl.appendChild(thinkingDiv);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        var context = contextEl.dataset.context || '';
        var messages = [];
        if (context) {
            messages.push({ role: 'system', content: '你是一个 AI 助教。用户引用了以下内容:\n\n' + context });
        }
        messages.push({ role: 'system', content: '请用中文回答，简洁明确。' });
        messages = messages.concat(chatHistory);

        var bookId = window.currentBookId || '';
        if (!bookId) {
            thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600 rounded-bl-sm">请先选择一本书</div>';
            return;
        }
        fetch((window.serverBaseUrl || '') + '/api/books/' + bookId + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messages })
        }).then(function (resp) {
            if (!resp.ok) {
                thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600 rounded-bl-sm">请求失败 (' + resp.status + ')</div>';
                return;
            }
            var reader = resp.body.getReader();
            var decoder = new TextDecoder();
            var fullText = '';

            function readStream() {
                reader.read().then(function (result) {
                    if (result.done) {
                        if (fullText) chatHistory.push({ role: 'assistant', content: fullText });
                        return;
                    }
                    var chunk = decoder.decode(result.value, { stream: true });
                    var lines = chunk.split('\n');
                    lines.forEach(function (line) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                var json = JSON.parse(line.substring(6));
                                var content = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content || '';
                                if (content) {
                                    fullText += content;
                                    thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-gray-100 text-gray-700 rounded-bl-sm">' +
                                        fullText.replace(/\n/g, '<br>').replace(/ /g, '&nbsp;') + '</div>';
                                    messagesEl.scrollTop = messagesEl.scrollHeight;
                                }
    } catch (e) {}
                        }
                    });
                    readStream();
                }).catch(function (err) {
                    thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600 rounded-bl-sm">连接中断: ' + err.message + '</div>';
                });
            }
            readStream();
        }).catch(function (err) {
            thinkingDiv.innerHTML = '<div class="inline-block max-w-[85%] px-3 py-2 rounded-lg text-xs bg-red-50 text-red-600 rounded-bl-sm">网络错误: ' + err.message + '</div>';
        });
    }

    sendBtn.addEventListener('click', function () {
        sendMessage(inputEl.value);
    });

    inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(this.value);
        }
    });

    promptBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var context = contextEl.dataset.context || '';
            if (context) {
                sendMessage(this.textContent.trim() + ':\n' + context.substring(0, 500));
            } else {
                sendMessage(this.textContent.trim());
            }
        });
    });

    // 面板外点击关闭
    document.addEventListener('mousedown', function (e) {
        if (panel.classList.contains('hidden')) return;
        if (!panel.contains(e.target) && e.target !== aiChatBtn && !aiChatBtn.contains(e.target) && e.target !== highlightAiBtn && !(highlightAiBtn && highlightAiBtn.contains(e.target))) {
            hidePanel();
        }
    });
})();

// ── 启动 ──
initProject();
initExporter();