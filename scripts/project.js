/**
 * project.js - MarkBook 在线版项目管理
 * 对接服务端 API，支持多书籍、章节管理、资源上传、搜索
 */

var STORAGE_KEY = 'markbook-project';
var SETTINGS_KEY = 'markbook-settings';
var project = null;
var serverMode = true;
var serverBaseUrl = window.location.origin;

// ── 工具函数 ──

function getDocTitle(fallback) {
    var match = editor.value.match(/^#{1,6}\s+(.+)/m);
    if (match) return match[1].trim().replace(/[\\/:*?"<>|]/g, '_');
    var ch = getCurrentChapter();
    return ch ? ch.title.replace(/[\\/:*?"<>|]/g, '_') : fallback;
}

function setSaveStatus(msg) {
    var el = document.getElementById('saveStatus');
    if (el) {
        el.textContent = (msg.includes('💾') ? '' : '💾 ') + msg;
        clearTimeout(el._timer);
        el._timer = setTimeout(function () {
            if (el.textContent.includes(msg)) el.textContent = '💾 已保存';
        }, 2000);
    }
}

function showToast(msg, type) {
    type = type || 'info';
    var c = document.getElementById('toastContainer');
    if (!c) return;
    var colors = { info: 'bg-gray-700', success: 'bg-green-600', warning: 'bg-yellow-500', error: 'bg-red-500' };
    var t = document.createElement('div');
    t.className = (colors[type] || 'bg-gray-700') + ' text-white px-4 py-2 rounded-lg shadow-lg text-sm mb-2';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(function () {
        if (!t.parentNode) return;
        t.style.transition = 'opacity 0.3s';
        t.style.opacity = '0';
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, 2500);
}

// ── API 调用 ──

async function api(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body && typeof body === 'object') {
        if (body instanceof FormData) {
            opts.body = body;
        } else if (method === 'POST' || method === 'PUT') {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
    }
    try {
        var resp = await fetch(serverBaseUrl + path, opts);
        if (resp.headers.get('content-type')?.includes('text/event-stream')) return resp;
        var data = await resp.json();
        if (!resp.ok) throw new Error(data.error || '请求失败: ' + resp.status);
        return data;
    } catch (e) {
        if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
            throw new Error('无法连接服务器');
        }
        throw e;
    }
}

// ── 数据模型 ──

function createProject(title, author, description) {
    return {
        id: 'local_' + Date.now(),
        title: title || '未命名书籍',
        author: author || '',
        description: description || '',
        chapters: [],
        currentChapterId: null,
    };
}

function loadProject() {
    try {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            project = JSON.parse(saved);
            return;
        }
    } catch (e) {}
    project = createProject();
}

function saveProject() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

function getCurrentChapter() {
    return project.chapters.find(function (c) { return c.id === project.currentChapterId; }) || project.chapters[0] || null;
}

// ── 书籍管理 ──

var currentBookId = localStorage.getItem('markbook-current-book');
var allBooks = [];

async function loadBookList() {
    try {
        allBooks = await api('GET', '/api/books');
        if (allBooks.length > 0) {
            // 恢复上次打开的书籍
            if (currentBookId && allBooks.some(function (b) { return b.id === currentBookId; })) {
                return await loadBook(currentBookId);
            }
            return await loadBook(allBooks[0].id);
        }
        // 没有书籍 → 尝试导入
        try {
            var result = await api('POST', '/api/books/import');
            if (result.id) {
                allBooks.push({ id: result.id, title: result.title });
                return await loadBook(result.id);
            }
        } catch (e) {}
        return null;
    } catch (e) {
        showToast('服务器连接失败: ' + e.message, 'error');
        loadProject(); // fallback 到本地
        renderSidebar();
        renderChapterInEditor();
        return null;
    }
}

async function loadBook(bookId) {
    try {
        var data = await api('GET', '/api/books/' + bookId);
        currentBookId = bookId;
        localStorage.setItem('markbook-current-book', bookId);
        project = createProject(data.title, data.author, data.description);
        project.id = data.id;
        project.chapters = data.chapters.map(function (ch) {
            return { id: ch.id, title: ch.title, content: '', resources: ch.resources || 0, status: ch.status || '' };
        });
        project.currentChapterId = project.chapters[0]?.id || null;
        saveProject();
        updateBookTitleDisplay();
        updateChapterCount();
        renderSidebar();
        if (project.currentChapterId) {
            await loadChapterContent(project.currentChapterId);
        }
        return project;
    } catch (e) {
        showToast('加载书籍失败: ' + e.message, 'error');
        return null;
    }
}

async function loadChapterContent(chapterId) {
    if (!currentBookId) return;
    try {
        var data = await api('GET', '/api/books/' + currentBookId + '/chapters/' + chapterId);
        var ch = project.chapters.find(function (c) { return c.id === chapterId; });
        if (ch) {
            ch.content = data.content || '';
            ch.title = data.title || ch.title;
            ch.resources = data.resources || [];
            project.currentChapterId = chapterId;
            renderChapterInEditor();
        }
    } catch (e) {
        showToast('加载章节失败: ' + e.message, 'error');
    }
}

async function switchChapter(chapterId) {
    if (chapterId === project.currentChapterId) return;
    var current = getCurrentChapter();
    if (current) {
        saveCurrentChapter(current);
    }
    project.currentChapterId = chapterId;
    saveProject();
    renderSidebar();
    await loadChapterContent(chapterId);
    restoreProgress();
}

function saveCurrentChapter(ch) {
    if (!ch || !currentBookId) return;
    api('PUT', '/api/books/' + currentBookId + '/chapters/' + ch.id, { content: ch.content }).catch(function (e) {
        console.warn('保存到服务器失败:', e);
    });
}

// ── 自动保存 ──

var _autoSaveTimer;
function autoSave() {
    var ch = getCurrentChapter();
    if (!ch || !currentBookId) return;
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(function () {
        api('PUT', '/api/books/' + currentBookId + '/chapters/' + ch.id, { content: ch.content }).then(function () {
            setSaveStatus('已保存');
        }).catch(function () {
            setSaveStatus('保存失败');
        });
    }, 500);
}

// ── 章节操作 ──

async function addChapter(title) {
    if (!currentBookId) return;
    try {
        var data = await api('POST', '/api/books/' + currentBookId + '/chapters', { title: title || '新章节' });
        project.chapters.push({ id: data.id, title: data.title, content: '# ' + data.title + '\n\n' });
        project.currentChapterId = data.id;
        saveProject();
        renderSidebar();
        loadChapterContent(data.id);
        updateChapterCount();
        setSaveStatus('已添加: ' + data.title);
    } catch (e) {
        showToast('添加章节失败: ' + e.message, 'error');
    }
}

async function deleteChapter(chapterId) {
    if (!currentBookId) return;
    if (project.chapters.length <= 1) { showToast('至少保留一个章节', 'warning'); return; }
    var ch = project.chapters.find(function (c) { return c.id === chapterId; });
    if (!confirm('确定删除「' + (ch ? ch.title : '') + '」？')) return;
    try {
        await api('DELETE', '/api/books/' + currentBookId + '/chapters/' + chapterId);
        var idx = project.chapters.findIndex(function (c) { return c.id === chapterId; });
        project.chapters.splice(idx, 1);
        if (project.currentChapterId === chapterId) {
            project.currentChapterId = project.chapters[Math.min(idx, project.chapters.length - 1)].id;
        }
        saveProject();
        renderSidebar();
        if (project.currentChapterId) loadChapterContent(project.currentChapterId);
        updateChapterCount();
        setSaveStatus('已删除');
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

async function renameChapter(chapterId, newTitle) {
    if (!currentBookId || !newTitle.trim()) return;
    try {
        await api('PUT', '/api/books/' + currentBookId + '/chapters/' + chapterId, { title: newTitle });
        var ch = project.chapters.find(function (c) { return c.id === chapterId; });
        if (ch) {
            ch.title = newTitle;
            if (ch.content && ch.content.startsWith('# ')) {
                var lines = ch.content.split('\n');
                lines[0] = '# ' + newTitle;
                ch.content = lines.join('\n');
                if (chapterId === project.currentChapterId) {
                    editor.value = ch.content;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            renderSidebar();
            updateChapterCount();
        }
    } catch (e) {
        showToast('重命名失败: ' + e.message, 'error');
    }
}

function moveChapter(chapterId, direction) {
    var idx = project.chapters.findIndex(function (c) { return c.id === chapterId; });
    if (idx === -1) return;
    var newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= project.chapters.length) return;
    var tmp = project.chapters[idx];
    project.chapters[idx] = project.chapters[newIdx];
    project.chapters[newIdx] = tmp;
    saveProject();
    renderSidebar();
}

// ── 导入 .md 文件 ──

function importMdFiles(files) {
    var fileArray = Array.from(files);
    fileArray.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var content = e.target.result;
            var title = file.name.replace(/\.md$/i, '');
            var h1 = content.match(/^#\s+(.+)/m);
            if (h1) title = h1[1].trim();
            var ch = { id: 'ch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: title, content: content };
            project.chapters.push(ch);
            renderSidebar();
            updateChapterCount();
            if (project.chapters.length === 1 || !project.currentChapterId) {
                project.currentChapterId = ch.id;
                renderChapterInEditor();
            }
        };
        reader.readAsText(file);
    });
}

// ── TOC 生成 ──

function generateTOC() {
    var toc = [];
    for (var i = 0; i < project.chapters.length; i++) {
        var ch = project.chapters[i];
        var headings = (ch.content || '').match(/^(#{1,3})\s+(.+)/gm) || [];
        var entry = { id: ch.id, title: ch.title, level: 0, subItems: [] };
        for (var j = 0; j < headings.length; j++) {
            var h = headings[j];
            var level = h.match(/^#+/)[0].length;
            var text = h.replace(/^#+\s+/, '');
            if (level === 1) entry.subItems.push({ id: ch.id, title: text, level: 1 });
        }
        toc.push(entry);
    }
    return toc;
}

// ── 侧边栏渲染 ──

function renderSidebar() {
    var tree = document.getElementById('chapterTree');
    if (!tree || !project) return;
    tree.innerHTML = '';
    project.chapters.forEach(function (ch, idx) {
        var div = document.createElement('div');
        div.className = 'chapter-item group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer text-sm '
            + (ch.id === project.currentChapterId ? 'bg-blue-100 text-blue-800 font-medium' : 'hover:bg-gray-100 text-gray-700');
        div.dataset.chapterId = ch.id;

        var moveUp = document.createElement('button');
        moveUp.innerHTML = '<i class="fas fa-chevron-up text-xs"></i>';
        moveUp.className = 'chapter-move opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 px-0.5';
        moveUp.onclick = function (e) { e.stopPropagation(); moveChapter(ch.id, -1); };

        var moveDown = document.createElement('button');
        moveDown.innerHTML = '<i class="fas fa-chevron-down text-xs"></i>';
        moveDown.className = 'chapter-move opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 px-0.5';
        moveDown.onclick = function (e) { e.stopPropagation(); moveChapter(ch.id, 1); };

        var titleSpan = document.createElement('span');
        titleSpan.className = 'flex-1 truncate';
        titleSpan.textContent = ch.title;
        titleSpan.onclick = function () {
            switchChapter(ch.id);
            if (window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('sidebar-open');
                var so = document.getElementById('sidebarOverlay');
                if (so) so.classList.remove('sidebar-open');
            }
        };

        var actions = document.createElement('span');
        actions.className = 'chapter-actions opacity-0 group-hover:opacity-100 flex gap-0.5 ml-auto';

        // 过稿状态徽标（markbook_sync 导出的章节头部「状态：」行，server 端解析）
        var statusBadge = null;
        if (ch.status) {
            var SC = { '待过稿': '#d97706', '已过稿': '#059669', '已入管线': '#1c4fe8' };
            statusBadge = document.createElement('span');
            statusBadge.className = 'text-[10px] leading-none px-1.5 py-1 rounded-full font-medium whitespace-nowrap';
            statusBadge.style.color = SC[ch.status] || '#6b7280';
            statusBadge.style.background = (SC[ch.status] || '#9ca3af') + '22';
            statusBadge.textContent = ch.status;
        }

        // 一键标过稿（仅待过稿章节显示）：标完回产品根 markbook_sync import --all 导回
        if (ch.status === '待过稿') {
            var okBtn = document.createElement('button');
            okBtn.innerHTML = '<i class="fas fa-check text-xs"></i>';
            okBtn.className = 'text-gray-400 hover:text-green-600 px-0.5';
            okBtn.title = '标记已过稿（可回 Director 导回）';
            okBtn.onclick = function (e) {
                e.stopPropagation();
                api('POST', '/api/books/' + currentBookId + '/chapters/' + ch.id + '/status', { status: '已过稿' })
                    .then(function () {
                        ch.status = '已过稿';
                        renderSidebar();
                        showToast('已标记「已过稿」：回产品根执行 markbook_sync import --all 导回', 'success');
                    })
                    .catch(function (err) { showToast('标记失败: ' + err.message, 'error'); });
            };
            actions.appendChild(okBtn);
        }

        var renameBtn = document.createElement('button');
        renameBtn.innerHTML = '<i class="fas fa-pen text-xs"></i>';
        renameBtn.className = 'text-gray-400 hover:text-blue-500 px-0.5';
        renameBtn.title = '重命名';
        renameBtn.onclick = function (e) {
            e.stopPropagation();
            var newTitle = prompt('章节名称:', ch.title);
            if (newTitle && newTitle.trim()) renameChapter(ch.id, newTitle.trim());
        };

        var delBtn = document.createElement('button');
        delBtn.innerHTML = '<i class="fas fa-times text-xs"></i>';
        delBtn.className = 'text-gray-400 hover:text-red-500 px-0.5';
        delBtn.title = '删除';
        delBtn.onclick = function (e) { e.stopPropagation(); deleteChapter(ch.id); };

        actions.appendChild(renameBtn);
        actions.appendChild(delBtn);
        div.appendChild(moveUp);
        div.appendChild(moveDown);
        div.appendChild(titleSpan);
        if (statusBadge) div.appendChild(statusBadge);
        div.appendChild(actions);
        tree.appendChild(div);
    });
}

function renderChapterInEditor() {
    var ch = getCurrentChapter();
    if (!ch) return;
    editor.value = ch.content || '';
    renderPreview(ch.content || '');
    updateLineNumbers();
    updateWordCount();
    var titleEl = document.getElementById('chapterTitleDisplay');
    if (titleEl) titleEl.textContent = ch.title || '未命名章节';
    clearHighlights();
    setSaveStatus('已加载');
}

function updateChapterCount() {
    var el = document.getElementById('chapterCount');
    if (el) el.textContent = project.chapters.length + ' 章';
}

function updateBookTitleDisplay() {
    var el = document.getElementById('bookTitleDisplay');
    if (el) el.textContent = project.title || '未命名书籍';
}

// ── 阅读进度 ──

function saveProgress() {
    var ch = getCurrentChapter();
    if (!ch || !currentBookId) return;
    var pct = 0;
    if (preview.scrollHeight > preview.clientHeight) pct = preview.scrollTop / (preview.scrollHeight - preview.clientHeight);
    try {
        var progress = JSON.parse(localStorage.getItem('markbook-progress') || '{}');
        if (!progress[currentBookId]) progress[currentBookId] = {};
        progress[currentBookId][ch.id] = pct;
        localStorage.setItem('markbook-progress', JSON.stringify(progress));
    } catch (e) {}
}

function restoreProgress() {
    var ch = getCurrentChapter();
    if (!ch || !currentBookId) return;
    try {
        var progress = JSON.parse(localStorage.getItem('markbook-progress') || '{}');
        var pct = (progress[currentBookId] || {})[ch.id];
        if (pct && preview.scrollHeight > preview.clientHeight) {
            preview.scrollTop = pct * (preview.scrollHeight - preview.clientHeight);
        }
    } catch (e) {}
}

// ── 搜索 ──

async function searchBook(keyword) {
    if (!currentBookId || !keyword.trim()) { return []; }
    try {
        var result = await api('POST', '/api/books/' + currentBookId + '/search', { q: keyword });
        return result.results || [];
    } catch (e) {
        console.warn('搜索失败:', e);
        return [];
    }
}

// ── 打开文件夹（本地模式） ──

function openFolder(files) {
    var mdFiles = [];
    for (var i = 0; i < files.length; i++) {
        if (files[i].name.endsWith('.md') || files[i].name.endsWith('.markdown')) mdFiles.push(files[i]);
    }
    if (mdFiles.length === 0) { showToast('未找到 .md 文件', 'warning'); return; }
    mdFiles.sort(function (a, b) { return a.webkitRelativePath.localeCompare(b.webkitRelativePath, undefined, { numeric: true }); });
    project = createProject('本地书籍');
    project.chapters = [];
    var loaded = 0;
    mdFiles.forEach(function (file) {
        var reader = new FileReader();
        reader.onload = function (ev) {
            var content = ev.target.result;
            var title = file.name.replace(/\.md$/i, '');
            var h1 = content.match(/^#\s+(.+)/m);
            if (h1) title = h1[1].trim();
            var ch = { id: 'ch_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title: title, content: content };
            project.chapters.push(ch);
            loaded++;
            if (loaded === mdFiles.length) {
                project.currentChapterId = project.chapters[0]?.id || '';
                saveProject();
                renderSidebar();
                renderChapterInEditor();
                updateChapterCount();
                setSaveStatus('已加载 ' + loaded + ' 个章节');
            }
        };
        reader.readAsText(file);
    });
}

// ── 初始化 ──

var _progressTimer = null;

function initProject() {
    loadProject();

    // 加载书籍列表（在线模式）
    loadBookList().then(function () {
        if (project && project.currentChapterId && !getCurrentChapter()) {
            if (project.chapters.length > 0) {
                project.currentChapterId = project.chapters[0].id;
                var ch = getCurrentChapter();
                if (ch) {
                    editor.value = ch.content || '';
                    renderPreview(ch.content || '');
                }
            }
        }
    });

    updateBookTitleDisplay();
    updateChapterCount();

    // 自动保存
    editor.addEventListener('input', function () {
        var ch = getCurrentChapter();
        if (ch) {
            ch.content = this.value;
            saveProject();
            autoSave();
        }
    });

    // 阅读进度
    preview.addEventListener('scroll', function () {
        clearTimeout(_progressTimer);
        _progressTimer = setTimeout(saveProgress, 500);
    });

    var origRender = renderChapterInEditor;
    renderChapterInEditor = function () {
        origRender();
        setTimeout(restoreProgress, 100);
    };

    // ── 书籍列表按钮 ──
    document.getElementById('bookListBtn').addEventListener('click', function () {
        document.getElementById('bookListModal').classList.remove('hidden');
        renderBookList();
    });
    document.getElementById('closeBookListBtn').addEventListener('click', function () {
        document.getElementById('bookListModal').classList.add('hidden');
    });
    (function() {
        var modal = document.getElementById('bookListModal');
        modal.addEventListener('click', function (e) {
            if (e.target === modal) modal.classList.add('hidden');
        });
    })();

    // ── 新建书籍 ──
    document.getElementById('createBookBtn').addEventListener('click', async function () {
        var title = document.getElementById('newBookTitle').value.trim() || '新书籍';
        var author = document.getElementById('newBookAuthor').value.trim();
        var desc = '';
        try {
            var form = new FormData();
            form.append('title', title);
            form.append('author', author);
            form.append('description', desc);
            var data = await api('POST', '/api/books', form);
            document.getElementById('newBookTitle').value = '';
            document.getElementById('newBookAuthor').value = '';
            showToast('书籍已创建', 'success');
            await loadBook(data.id);
            renderBookList();
        } catch (e) {
            showToast('创建失败: ' + e.message, 'error');
        }
    });

    // ── 导入预置书籍 ──
    document.getElementById('importPresetBtn').addEventListener('click', async function () {
        try {
            var data = await api('POST', '/api/books/import');
            showToast('导入成功: ' + data.title, 'success');
            renderBookList();
            if (data.id) loadBook(data.id);
        } catch (e) {
            showToast('导入失败: ' + e.message, 'error');
        }
    });

    // ── 导入文档成书（EPUB/DOCX/TXT/MD → /api/books/import-doc）──
    var importDocInput = document.getElementById('importDocInput');
    document.getElementById('importDocBtn').addEventListener('click', function () {
        importDocInput.click();
    });
    importDocInput.addEventListener('change', async function () {
        var file = importDocInput.files && importDocInput.files[0];
        importDocInput.value = '';
        if (!file) return;
        showToast('正在解析 ' + file.name + '（大文档可能要一会儿）…', 'info');
        try {
            var fd = new FormData();
            fd.append('file', file);
            var resp = await fetch('/api/books/import-doc', { method: 'POST', body: fd });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.detail || ('HTTP ' + resp.status));
            showToast('导入成功: ' + data.title + '（' + data.chapter_count + ' 章）', 'success');
            (data.warnings || []).forEach(function (w) { showToast(w, 'warning'); });
            renderBookList();
            if (data.id) loadBook(data.id);
        } catch (e) {
            showToast('导入失败: ' + e.message, 'error');
        }
    });

    // ── 侧边栏 ──
    var sidebar = document.getElementById('sidebar');
    var sidebarOverlay = document.getElementById('sidebarOverlay');
    function toggleSidebar() {
        var isMobile = window.innerWidth <= 768;
        if (isMobile) {
            sidebar.classList.toggle('sidebar-open');
            if (sidebarOverlay) sidebarOverlay.classList.toggle('sidebar-open', sidebar.classList.contains('sidebar-open'));
            if (sidebarOverlay && sidebar.classList.contains('sidebar-open')) sidebarOverlay.style.display = 'block';
        } else {
            sidebar.classList.toggle('sidebar-collapsed');
            var icon = document.querySelector('#sidebarToggle i');
            if (icon) icon.className = sidebar.classList.contains('sidebar-collapsed') ? 'fas fa-chevron-right text-lg' : 'fas fa-bars text-lg';
        }
    }
    document.getElementById('sidebarToggle').addEventListener('click', toggleSidebar);
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', function () {
            sidebar.classList.remove('sidebar-open');
            sidebarOverlay.classList.remove('sidebar-open');
            sidebarOverlay.style.display = 'none';
        });
    }

    document.getElementById('addChapterBtn').addEventListener('click', function () {
        addChapter();
        sidebar.classList.remove('sidebar-collapsed');
        var icon = document.querySelector('#sidebarToggle i');
        if (icon) icon.className = 'fas fa-bars text-lg';
    });
    document.getElementById('addChapterSideBtn').addEventListener('click', function () { addChapter(); });

    var importBtn = document.getElementById('importMdBtn');
    var importInput = document.getElementById('importMdInput');
    importBtn.addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) importMdFiles(e.target.files);
        e.target.value = '';
    });

    var folderInput = document.getElementById('folderInput');
    document.getElementById('openFolderBtn').addEventListener('click', function () { folderInput.click(); });
    folderInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) openFolder(e.target.files);
        e.target.value = '';
    });

    // ── 元数据 ──
    var metaModal = document.getElementById('bookMetaModal');
    document.getElementById('bookMetaBtn').addEventListener('click', function () {
        document.getElementById('metaBookTitle').value = project.title || '';
        document.getElementById('metaAuthor').value = project.author || '';
        document.getElementById('metaCover').value = project.cover || '';
        document.getElementById('metaDesc').value = project.description || '';
        metaModal.classList.remove('hidden');
    });
    document.getElementById('metaCancelBtn').addEventListener('click', function () { metaModal.classList.add('hidden'); });
    document.getElementById('metaSaveBtn').addEventListener('click', async function () {
        project.title = document.getElementById('metaBookTitle').value || '未命名书籍';
        project.author = document.getElementById('metaAuthor').value;
        project.cover = document.getElementById('metaCover').value;
        project.description = document.getElementById('metaDesc').value;
        saveProject();
        if (currentBookId) {
            try {
                await api('PUT', '/api/books/' + currentBookId, {
                    title: project.title, author: project.author,
                    cover: project.cover, description: project.description,
                });
            } catch (e) {}
        }
        updateBookTitleDisplay();
        metaModal.classList.add('hidden');
        setSaveStatus('书籍信息已更新');
        renderBookList();
    });

    // ── 只读模式 ──
    (function initReadonly() {
        var saved = localStorage.getItem('markbook-readonly');
        if (saved === 'true') applyReadonlyMode(true);
    })();
    document.getElementById('readonlyToggle').addEventListener('click', toggleReadonlyMode);

    // ── 服务器连接 ──
    var connectBtn = document.getElementById('serverConnectBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', function () {
            var url = document.getElementById('serverUrl').value.replace(/\/+$/, '');
            if (url) serverBaseUrl = url;
            showToast('已切换服务器: ' + serverBaseUrl, 'info');
            loadBookList();
        });
    }

    // ── 快捷键 n/p ──
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
        var ch = getCurrentChapter();
        if (!ch || !project) return;
        var idx = project.chapters.findIndex(function (c) { return c.id === ch.id; });
        if (e.key === 'n' || e.key === 'N') {
            if (idx < project.chapters.length - 1) switchChapter(project.chapters[idx + 1].id);
        }
        if (e.key === 'p' || e.key === 'P') {
            if (idx > 0) switchChapter(project.chapters[idx - 1].id);
        }
    });

    // ── 窗口 resize ──
    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            if (window.innerWidth > 768) {
                sidebar.classList.remove('sidebar-open');
                if (sidebarOverlay) sidebarOverlay.classList.remove('sidebar-open');
            }
        }, 200);
    });
}

// ── 渲染书籍列表 ──

function renderBookList() {
    var list = document.getElementById('bookListItems');
    if (!list) return;
    list.innerHTML = '';
    allBooks.forEach(function (book) {
        var div = document.createElement('div');
        div.className = 'flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-100 cursor-pointer transition-colors '
            + (book.id === currentBookId ? 'bg-blue-50 border border-blue-200' : '');
        div.onclick = function () {
            document.getElementById('bookListModal').classList.add('hidden');
            loadBook(book.id);
        };
        var info = document.createElement('div');
        info.className = 'flex-1 min-w-0';
        var titleEl = document.createElement('div');
        titleEl.className = 'text-sm font-medium text-gray-800 truncate';
        titleEl.textContent = book.title;
        var meta = document.createElement('div');
        meta.className = 'text-xs text-gray-400';
        meta.textContent = (book.chapter_count || '?') + ' 章' + (book.author ? ' · ' + book.author : '');
        info.appendChild(titleEl);
        info.appendChild(meta);
        var active = document.createElement('span');
        if (book.id === currentBookId) {
            active.innerHTML = '<i class="fas fa-check text-blue-500 text-xs"></i>';
        }
        div.appendChild(info);
        div.appendChild(active);
        list.appendChild(div);
    });
}

// ── 只读模式 ──

function applyReadonlyMode(on) {
    document.body.classList.toggle('readonly', on);
    editor.readOnly = on;
    var btn = document.getElementById('readonlyToggle');
    var icon = btn.querySelector('i');
    icon.className = on ? 'fas fa-lock' : 'fas fa-lock-open';
    btn.title = on ? '切换到编辑模式' : '切换到只读模式';
    localStorage.setItem('markbook-readonly', on ? 'true' : 'false');
}

function toggleReadonlyMode() {
    applyReadonlyMode(!document.body.classList.contains('readonly'));
}