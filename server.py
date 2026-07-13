#!/usr/bin/env python3
"""
MarkBook 在线服务平台 — 一条命令启动

  python server.py                  # 默认 http://localhost:8765
  python server.py --port 8765      # 指定端口
  python server.py --host 0.0.0.0   # 监听所有地址

第一次启动会自动扫描 library/ 目录导入所有预置书籍。

环境变量（在 .env 中配置）:
  MARKBOOK_LLM_ENDPOINT  LLM API 地址
  MARKBOOK_LLM_API_KEY   API Key
  MARKBOOK_LLM_MODEL     模型名
"""

import os, sys, json, time, argparse
from pathlib import Path

# Windows GBK 编码兼容
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

sys.path.insert(0, str(Path(__file__).parent))

# 确保依赖可用
try:
    import uvicorn
    from fastapi import FastAPI
except ImportError:
    print("正在安装依赖...")
    os.system(f"{sys.executable} -m pip install -q fastapi uvicorn python-multipart aiofiles httpx")
    import uvicorn
    from fastapi import FastAPI

BASE_DIR = Path(__file__).parent
BOOKS_DIR = BASE_DIR / "server" / "books"
PRESET_DIRS = {}
_bookshelf = BASE_DIR / "library"
if _bookshelf.is_dir():
    for _d in sorted(_bookshelf.iterdir()):
        if _d.is_dir() and not _d.name.startswith("."):
            PRESET_DIRS[_d.name] = _d


def auto_import():
    """启动时自动导入预置书籍"""
    from server.app import app as _app
    from fastapi.testclient import TestClient

    os.makedirs(BOOKS_DIR, exist_ok=True)
    client = TestClient(_app)

    for key, src_dir in PRESET_DIRS.items():
        if not src_dir.is_dir():
            print(f"  [SKIP] {key}: 目录不存在 {src_dir}")
            continue
        print(f"  检测到预置目录: {key} ({src_dir})")
        resp = client.post("/api/books/import", json={"source": key})
        if resp.status_code == 200:
            data = resp.json()
            if data.get("note") == "书籍已存在":
                print(f"  [OK] {data['title']} (已存在)")
            else:
                print(f"  [OK] 已导入: {data['title']} ({data.get('chapter_count', 0)} 章)")
        else:
            print(f"  [FAIL] 导入失败: {resp.text[:200]}")


def main():
    parser = argparse.ArgumentParser(description="MarkBook 在线服务")
    parser.add_argument("--port", type=int, default=8765, help="端口（默认 8765）")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址（默认 0.0.0.0）")
    args = parser.parse_args()

    print("+----------------------------------------------+")
    print("|      码客书 (MarkBook) 电子书平台            |")
    print("|      电子书写作与发布平台 v2.0             |")
    print("+----------------------------------------------+")

    auto_import()

    # 启动主服务
    print(f"\n  [启动服务...]")
    print(f"  管理界面: http://localhost:{args.port}")
    print(f"  API:      http://localhost:{args.port}/api/books")
    print(f"  AI 助教:   http://localhost:{args.port}/api/books/<id>/chat")
    print(f"  代码沙箱:  http://localhost:{args.port}/api/sandbox/run")
    print(f"  资源管理:   http://localhost:{args.port}/uploads")
    print(f"  \n  按 Ctrl+C 停止\n")

    # 延迟导入以让 auto_import 先执行
    from server.app import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()