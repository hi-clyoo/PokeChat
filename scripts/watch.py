#!/usr/bin/env python3
"""PokeChat 反馈队列事件监听 —— 给 AI agent loop 用（零依赖，仅标准库）。

用户在前端提交反馈 → 后端落盘 `data/{ts}.json`（pending 收件箱）。
本脚本**阻塞监听**该目录，一发现新反馈就打印一行 JSON，然后**退出**。

⚠️ 核心语义：**「退出」本身就是通知信号**。
agent 侧把它当后台任务跑 → 脚本退出 = 系统提示「有新反馈了」→ agent 去读输出。
所以它**不能循环等第二条**：那样永远不退出，也就永远不会通知。
代价是——**每处理完一条都要重启一次**。

触发方式：
  - macOS / BSD：kqueue（`EVFILT_VNODE` + `NOTE_WRITE`）内核事件，毫秒级，真·事件驱动
  - Windows / 其他：没有 kqueue → `--poll` 回退 2 秒轮询（比对文件名）

⚠️ 状态基线文件**必须按项目分开**（见 `state_default()`）。
写死一个全局路径会让多个 checkout 互相污染：A 项目先收到 `120000.json`，
B 项目收到**自己**的同名反馈时被当成「已见」→ `新文件 - 已见` 为空
→ **watcher 永不触发，且没有任何报错**——这是最难查的一类问题。

处理流程（收到反馈后）：
    data/*.json（pending）→ data/processing/（开始处理）→ data/done/ + conclusion（完成）

用法：
    python3 scripts/watch.py                 # 事件驱动（macOS / BSD）
    python3 scripts/watch.py --poll          # 轮询（Windows 必须；也可强制）
    python3 scripts/watch.py --once          # 只看一次就退出（调试）
    python3 scripts/watch.py --dir data --interval 2
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import time

# Windows 控制台默认 GBK：反馈 JSON 里有中文，ensure_ascii=False 打印会乱码，
# 严重时 UnicodeEncodeError **直接崩掉**（那就永远等不到通知了）。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_INBOX = os.path.join(REPO, "data")

# 这些文件不算「新反馈」：server.py 的队列存档、以及一切点开头的隐藏文件
SKIP = {"queue.json"}


def state_default(inbox: str) -> str:
    """状态基线文件默认路径 —— **按项目分开**（仓库目录名 + 收件箱绝对路径哈希）。

    为什么不能用一个全局路径（如 `/tmp/seen.json`）：基线存的是**纯文件名**，
    多个项目跑同一个 watcher 时文件名会互相污染（见模块 docstring 的说明）。
    """
    sig = hashlib.md5(os.path.abspath(inbox).encode("utf-8")).hexdigest()[:6]
    return os.path.join(
        tempfile.gettempdir(),
        "pokechat_watch_seen_%s_%s.json" % (os.path.basename(REPO), sig),
    )


def pending_names(inbox: str) -> set:
    """收件箱根目录下的待处理文件名（不含子目录、不含 queue.json / 隐藏文件）。"""
    try:
        return {
            f for f in os.listdir(inbox)
            if f.endswith(".json") and f not in SKIP and not f.startswith(".")
            and os.path.isfile(os.path.join(inbox, f))
        }
    except OSError:
        return set()


def _load_seen(state: str) -> set:
    try:
        with open(state, encoding="utf-8") as fh:
            return set(json.load(fh))
    except Exception:  # noqa: BLE001
        return set()


def _save_seen(state: str, seen: set) -> None:
    with open(state, "w", encoding="utf-8") as fh:
        json.dump(sorted(seen), fh, ensure_ascii=False)


def _emit(news: list, seen: set, state: str, inbox: str) -> None:
    """打印发现的新反馈（一行一条 JSON），写基线，返回给 main 由它退出。"""
    for name in news:
        try:
            with open(os.path.join(inbox, name), encoding="utf-8") as fh:
                item = json.load(fh)
        except Exception:  # noqa: BLE001
            item = {}
        print(json.dumps({"file": name, **item}, ensure_ascii=False), flush=True)
    _save_seen(state, seen)


def _baseline(state: str, inbox: str) -> set:
    """启动基线：把当前收件箱里已有的文件全记成「已见」，历史反馈不触发。"""
    seen = _load_seen(state)
    cur = pending_names(inbox)
    if cur:
        seen |= cur
        _save_seen(state, seen)
    return seen


def _kqueue_watch(inbox: str, state: str, timeout: float = 60.0) -> int:
    """阻塞等内核事件：目录内容一变就醒。非轮询。"""
    import select  # 局部 import：无 kqueue 的平台走 --poll

    os.makedirs(inbox, exist_ok=True)
    fd = os.open(inbox, os.O_RDONLY)
    kq = select.kqueue()
    ev = select.kevent(
        fd,
        filter=select.KQ_FILTER_VNODE,
        flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE | select.KQ_EV_CLEAR,
        fflags=(
            select.KQ_NOTE_WRITE | select.KQ_NOTE_EXTEND
            | select.KQ_NOTE_ATTRIB | select.KQ_NOTE_RENAME
        ),
    )
    kq.control([ev], 0, 0)
    seen = _baseline(state, inbox)
    while True:
        try:
            kq.control(None, 16, timeout)  # 阻塞；有新事件立刻返回
        except OSError:
            time.sleep(1)
        cur = pending_names(inbox)
        news = sorted(cur - seen)
        if news:
            _emit(news, seen | set(news), state, inbox)
            return 0
        try:
            kq.control([ev], 0, 0)  # 重新武装（EV_CLEAR 后）
        except OSError:
            pass


def _poll_watch(inbox: str, state: str, interval: float, once: bool) -> int:
    seen = _baseline(state, inbox)
    while True:
        cur = pending_names(inbox)
        news = sorted(cur - seen)
        if news:
            _emit(news, seen | set(news), state, inbox)
            return 0
        if once:
            return 0
        time.sleep(interval)


def main() -> int:
    ap = argparse.ArgumentParser(description="PokeChat 反馈队列事件监听（发现新反馈 → 打印 → 退出）")
    ap.add_argument("--dir", default=DEFAULT_INBOX, help="收件箱目录（默认 <仓库>/data）")
    ap.add_argument("--state", default="", help="已见文件基线（默认按项目分开；一般不用改）")
    ap.add_argument("--interval", type=float, default=2.0, help="轮询间隔秒（仅 --poll）")
    ap.add_argument("--poll", action="store_true", help="强制轮询（Windows 必须；kqueue 不可用时自动回退）")
    ap.add_argument("--once", action="store_true", help="只看一次就退出（调试）")
    args = ap.parse_args()

    inbox = os.path.abspath(args.dir)
    state = args.state or state_default(inbox)

    if args.once:
        # 调试用：**纯只读**报告当前 pending，不改基线。
        # （不能先跑 _baseline —— 那会把现存文件全吞进基线，什么都查不出来）
        news = sorted(pending_names(inbox) - _load_seen(state))
        for name in news:
            try:
                with open(os.path.join(inbox, name), encoding="utf-8") as fh:
                    item = json.load(fh)
            except Exception:  # noqa: BLE001
                item = {}
            print(json.dumps({"file": name, **item}, ensure_ascii=False), flush=True)
        print("[watch] --once：%d 条待处理（%d 个文件在收件箱）" % (len(news), len(pending_names(inbox))), flush=True)
        return 0

    if not args.poll:
        try:
            import select  # noqa: PLC0415
            if hasattr(select, "kqueue"):
                print("[watch] kqueue 事件驱动监听 %s" % inbox, flush=True)
                return _kqueue_watch(inbox, state)
        except Exception as e:  # noqa: BLE001
            print("[watch] kqueue 不可用，回退轮询: %r" % e, flush=True)
    print("[watch] 轮询模式（%.1fs）监听 %s" % (args.interval, inbox), flush=True)
    return _poll_watch(inbox, state, args.interval, args.once)


if __name__ == "__main__":
    sys.exit(main())
