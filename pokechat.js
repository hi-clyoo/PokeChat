/* PokeChat —— 组件选择反馈对话（零依赖，原生 JS）
 * 与 Vibe-Astock 项目版 100% 对齐的功能 + 玻璃风 UI
 *
 * 用法：<script src="pokechat.js"></script>
 *       PokeChat.init({ endpoint: "http://127.0.0.1:8123" });  // 可选：配后端后发送给 AI 并轮询回复
 *
 * 功能（对齐项目版）：
 *   1. 🎯 选择模式：悬停层级高亮（上级虚线 / 最内层实线）→ 点击 → 备注弹窗
 *   2. 备注弹窗：Enter 加入队列 / Shift+Enter 换行 / Ctrl+Enter 直接发送 /
 *      Home-End 行级 / Ctrl+Home-End 文档级 / IME 输入法保护
 *   3. 队列：常驻悬浮（localStorage 持久化），条目可编辑，批量发送
 *   4. 对话面板：IM（左 AI 回复/右用户消息 + 状态标签），左侧索引（直接/组件分组），
 *      底部直接发消息，自动滚动到最新，完整回复展示
 *   5. 任务状态：发送后 等待调度/处理中/已完成 三态
 */
(function (global) {
  "use strict";

  var DEFAULT_ENDPOINT = "";
  var QUEUE_KEY = "pokechat-queue";
  var STATUS_KEY = "pokechat-status";

  // API 前缀可配（2026-08-22）：开源 server.py 用 /api/feedback；
  // 接入 vibe-astock 本地后端（/api/ui-feedback 系）时传 apiPrefix: "/api/ui-feedback"
  var cfg = { endpoint: DEFAULT_ENDPOINT, apiPrefix: "/api/feedback" };
  // 2026-08-22 修复：去掉多余斜杠——api("/") 曾拼出 /api/ui-feedback/ 尾斜杠 → POST 405 发送失败
  function api(path) {
    var p = (path || "").replace(/^\/+/, "").replace(/\/+$/, "");
    return (cfg.endpoint + cfg.apiPrefix).replace(/\/+$/, "") + (p ? "/" + p : "");
  }
  // 是否配了后端：endpoint 或 apiPrefix 任一存在即视为后端模式。
  // ⚠️ 2026-08-22 修复：本地同源接入 endpoint="" 时，旧判断 if (cfg.endpoint) 为空字符串假值，
  // 导致状态轮询/历史加载/发送全走"本地模式"——用户反馈"没有显示历史的数据"
  function hasBackend() { return !!(cfg.endpoint || cfg.apiPrefix); }
  var queue = [];
  var picking = false;
  var picked = null;
  var note = "";
  var directMsg = "";
  var status = { pending: [], processing: [], done: [] };
  var qOpen = false;      // 队列面板（大弹窗）
  var editing = null;     // 正在编辑的队列条目
  var selectedEl = null;
  var sub = {};

  /* ================= 工具 ================= */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function loadQueue() {
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") || []; } catch (e) { queue = []; }
    // 可选：从后端恢复队列（配 queueApi 时，如 vibe-astock 的 /api/ui-feedback/queue，2026-08-22）
    if (cfg.queueApi && hasBackend()) {
      fetch(cfg.endpoint + cfg.queueApi).then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && Array.isArray(d.items) && d.items.length) { queue = d.items; saveQueue(); renderFloating(); }
        }).catch(function () {});
    }
  }
  function saveQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    // 可选：后端持久化（配 queueApi 时）
    if (cfg.queueApi && hasBackend()) {
      fetch(cfg.endpoint + cfg.queueApi, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: queue }) })
        .catch(function () {});
    }
  }
  function post(url, body, cb) {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(cb).catch(function () {});
  }

  /* ================= 玻璃风样式（100% 对齐项目 index.css token，2026-08-22） ================= */
  // 项目暗色主题：背景 hsl(222 47% 6%)、卡 hsl(222 40% 9%)、主色暖橙红 hsl(15 89% 56%)≈#F35D2B、
  // glass 渐变 + 发丝边框 + 内高光 + blur(14px) + 圆角 1rem
  var GLASS_CSS = [
    ":root { --pc-bg:hsl(222 47% 6%); --pc-card:hsl(222 40% 9%); --pc-card-2:rgba(255,255,255,.09);",
    "  --pc-border:rgba(255,232,214,.16); --pc-primary:hsl(15 89% 56%);",
    "  --pc-text:hsl(210 30% 94%); --pc-muted:hsl(215 20% 76%); --pc-muted-2:hsla(215,20%,76%,.6);",
    "  --pc-danger:hsl(0 74% 60%); --pc-warn:hsl(38 92% 55%); --pc-green:hsl(152 55% 46%);",
    "  --pc-hi:rgba(255,255,255,.08); --pc-radius:1rem; }",
    // 2026-08-22 整体可读性优化：glass 底色加深（白色叠加 .10/.05）+ 保留毛玻璃 blur + 发丝边框；
    // muted 色提亮（62%→76%）——之前文字在透底上对比度不足看不清
    "[data-pokechat] { font-family: system-ui, sans-serif; color: var(--pc-text); }",
    "[data-pokechat] .pc-glass { background-image: linear-gradient(162deg, rgba(255,255,255,.10), rgba(255,255,255,.05));",
    "  border:1px solid var(--pc-border); border-radius:var(--pc-radius);",
    "  box-shadow: 0 12px 30px rgba(0,0,0,.35), inset 0 1px 0 var(--pc-hi);",
    "  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }",
    "[data-pokechat] .pc-btn { background: var(--pc-card-2); color: var(--pc-text); border:1px solid var(--pc-border);",
    "  border-radius:9px; padding:6px 12px; cursor:pointer; font-size:13px; transition: all .15s; }",
    "[data-pokechat] .pc-btn:hover { background: rgba(255,255,255,.14); }",
    "[data-pokechat] .pc-btn-primary { background: var(--pc-primary); color:hsl(222 47% 6%); font-weight:600; border-color:transparent; }",
    "[data-pokechat] .pc-btn-primary:hover { opacity:.9; }",
    "[data-pokechat] .pc-input, [data-pokechat] .pc-textarea { background: rgba(255,255,255,.08); color: var(--pc-text);",
    "  border:1px solid var(--pc-border); border-radius:9px; padding:8px 10px; font-size:13px; width:100%;",
    "  box-sizing:border-box; outline:none; }",
    "[data-pokechat] .pc-input:focus, [data-pokechat] .pc-textarea:focus { border-color: var(--pc-primary); }",
    "[data-pokechat] .pc-modal { position:fixed; inset:0; z-index:2147483000; background:rgba(0,0,0,.55);",
    "  display:flex; align-items:center; justify-content:center; padding:20px; }",
    // ⚠️ 2026-08-22 修复：弹窗的 hidden 加在自身（如 data-pokechat='queue' 元素），
    // 原选择器 [data-pokechat] .hidden 是后代选择器不匹配自身 + 弹窗内联 display:flex 覆盖 → 关不掉
    "[data-pokechat].hidden, [data-pokechat] .hidden { display:none !important; }",
    // 2026-08-22 修复：badge 文字太暗看不清 → 亮色纯文字 + 稍实背景
    "[data-pokechat] .pc-badge { border-radius:6px; padding:1px 6px; font-size:10px; font-weight:700; }",
    "[data-pokechat] .pc-badge-done { background:rgba(52,211,153,.25); color:#6ee7b7; }",
    "[data-pokechat] .pc-badge-proc { background:rgba(251,191,36,.25); color:#fcd34d; }",
    "[data-pokechat] .pc-badge-wait { background:rgba(148,163,184,.25); color:#cbd5e1; }",
    ".pokechat-picking, .pokechat-picking * { cursor: crosshair !important; }",
    ".pokechat-picking *:hover { outline:1px dashed hsl(15 89% 56% / .55) !important; outline-offset:1px; }",
    ".pokechat-picking *:hover:not(:has(*:hover)) { outline:2px solid var(--pc-primary) !important; outline-offset:1px; }",
  ].join("\n");

  /* ================= 选择模式（层级高亮） ================= */
  function pickInfo(node) {
    var cls = Array.prototype.slice.call(node.classList || []).slice(0, 3).join(".");
    var txt = (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      tag: node.tagName.toLowerCase(),
      selector: node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + (cls ? "." + cls : ""),
      text: txt,
    };
  }
  function clearOutline() { if (selectedEl) { selectedEl.style.outline = ""; selectedEl = null; } }
  function startPicking() {
    if (picking) return;
    picking = true;
    document.body.classList.add("pokechat-picking");
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onCtx, true);
    document.addEventListener("keydown", onPickKey, true);
    if (window.__pcRenderPickIcon) window.__pcRenderPickIcon();  // 图标切换 X
  }
  function stopPicking() {
    if (!picking) return;
    picking = false;
    document.body.classList.remove("pokechat-picking");
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onCtx, true);
    document.removeEventListener("keydown", onPickKey, true);
    clearOutline();
    renderFloating();
    if (window.__pcRenderPickIcon) window.__pcRenderPickIcon();  // 图标切回鼠标指针
  }
  // 2026-08-22：PokeChat 自己的 UI（对话窗口/弹窗/悬浮区/控制按钮）都可以被选择反馈，
  // 不做排除——任何元素都可点选
  function onOver(e) {
    var t = e.target;
    if (!t) return;
    clearOutline();
    selectedEl = t;
    t.style.outline = "2px solid #22c55e";
    t.style.outlineOffset = "1px";
  }
  function onClick(e) {
    var t = e.target;
    if (!t) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var info = pickInfo(t);
    stopPicking();
    selectedEl = t;
    t.style.outline = "2px solid #22c55e";
    openNoteDialog(info);
  }
  function onCtx(e) { e.preventDefault(); stopPicking(); }
  function onPickKey(e) {
    if (e.key === "Escape") stopPicking();
  }
  // 全局 Ctrl+F 启动/退出选择模式（对齐项目版；拦截浏览器查找，2026-08-22）
  document.addEventListener("keydown", function (e) {
    if (e.key === "f" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      if (picking) stopPicking(); else startPicking();
    }
  }, true);

  /* ================= 备注弹窗（对齐项目版） ================= */
  // 弹窗互斥（2026-08-22）：React 原版是条件渲染天然互斥，PokeChat 常驻 DOM + hidden
  // 切换必须手动互斥——打开任一弹窗先关掉其他弹窗，避免叠开
  function closeAllDialogs(except) {
    [["note", "note"], ["edit", "edit"], ["queue", "queue"]].forEach(function (pair) {
      if (pair[1] !== except) {
        var m = $("[data-pokechat='" + pair[0] + "']");
        if (m) m.classList.add("hidden");
      }
    });
  }
  function openNoteDialog(info) {
    picked = info;
    note = "";
    // 2026-08-22 修复：IM 窗口开着时使用组件反馈，弹窗会自动消失——不能再 closeAllDialogs("note")
    // 关掉 queue（IM 窗口）。只关编辑弹窗，note 叠加在 IM 之上（z-index 3002）
    var editDlg = $("[data-pokechat='edit']");
    if (editDlg) editDlg.classList.add("hidden");
    var m = $("[data-pokechat='note']");
    $("[data-pc-path]", m).textContent = location.pathname + location.search;
    $("[data-pc-sel]", m).textContent = info.selector;
    $("[data-pc-txt]", m).textContent = info.text || "（无文本）";
    var ta = $("[data-pc-note]", m);
    ta.value = "";
    note = "";
    m.classList.remove("hidden");
    // 打开时同步按钮 disabled（备注为空禁用提交）
    var add = $("[data-pc-add]", m), sd = $("[data-pc-sendd]", m);
    if (add) { add.disabled = true; add.style.opacity = ".5"; }
    if (sd) { sd.disabled = true; sd.style.opacity = ".5"; }
    ta.focus();
  }
  function closeNoteDialog() { $("[data-pokechat='note']").classList.add("hidden"); picked = null; clearOutline(); }
  function addToQueue() {
    if (!picked || !note.trim()) return;
    queue.push({ path: location.pathname + location.search, selector: picked.selector, text: picked.text, note: note, ts: Date.now() });
    saveQueue(); renderFloating();
    closeNoteDialog();
    toast("已加入反馈队列（共 " + queue.length + " 条），Ctrl+F 可再次选择");
  }
  function sendDirectFromDialog() {
    if (!picked || !note.trim()) return;
    sendFeedback([{ path: location.pathname + location.search, selector: picked.selector, text: picked.text, note: note }]);
    closeNoteDialog();
  }
  function sendFeedback(items) {
    if (hasBackend()) {
      post(api("/"), { items: items }, function () { refreshStatus(); toast("已发送给 AI，等待处理"); });
    } else {
      items.forEach(function (it) { queue.push({ path: it.path, selector: it.selector, text: it.text, note: it.note, ts: Date.now(), local: true }); });
      saveQueue(); renderFloating(); toast("本地模式：已记录在 localStorage");
    }
  }

  /* ================= 队列编辑 ================= */
  function openEdit(it) {
    editing = it; note = it.note;
    // 2026-08-22 修复：编辑弹窗要**叠加**在 IM 窗口之上（React 原版两层同显）。
    // 只关备注弹窗，保留 IM 窗口；z-index 由 buildEditDialog 的 2147483001 保证在上层
    var noteDlg = $("[data-pokechat='note']");
    if (noteDlg) noteDlg.classList.add("hidden");
    var m = $("[data-pokechat='edit']");
    $("[data-pc-path]", m).textContent = it.path;
    $("[data-pc-sel]", m).textContent = it.selector;
    $("[data-pc-txt]", m).textContent = it.text || "（无文本）";
    $("[data-pc-note]", m).value = it.note;
    var save = $("[data-pc-save]", m);
    if (save) { save.disabled = !it.note.trim(); save.style.opacity = it.note.trim() ? "1" : ".5"; }
    m.classList.remove("hidden");
  }
  function closeEdit() { $("[data-pokechat='edit']").classList.add("hidden"); editing = null; }
  function saveEdit() {
    if (!editing) return;
    queue = queue.map(function (x) { return x.ts === editing.ts ? Object.assign({}, x, { note: note }) : x; });
    saveQueue(); renderFloating(); closeEdit();
  }
  function removeQueueItem(ts) { queue = queue.filter(function (x) { return x.ts !== ts; }); saveQueue(); renderFloating(); }
  function clearQueue() { queue = []; saveQueue(); renderFloating(); }
  function sendQueue() {
    if (!queue.length) return;
    var items = queue.map(function (q) { return { path: q.path, selector: q.selector, text: q.text, note: q.note }; });
    if (hasBackend()) {
      post(api("/"), { items: items }, function () { queue = []; saveQueue(); renderFloating(); refreshStatus(); toast("已发送 " + items.length + " 条反馈，等待 AI 处理"); });
    } else {
      toast("本地模式：未配置 endpoint，队列保留在 localStorage");
      qOpen = false; renderQueueDialog();
    }
  }

  /* ================= 状态轮询 ================= */
  function refreshStatus() {
    if (!hasBackend()) return;
    fetch(api("/status")).then(function (r) { return r.json(); })
      .then(function (d) {
        status = d;
        renderQueueDialog();
        renderFloating();  // 2026-08-22 修复：状态变化同步悬浮按钮（数字 + 处理中 ping 点）
      }).catch(function () {});
  }

  /* ================= UI：悬浮区（任务上 / 队列+🎯 下，对齐项目版） ================= */
  function buildUI() {
    var css = document.createElement("style");
    css.textContent = GLASS_CSS;
    document.head.appendChild(css);

    var wrap = el("div", null);
    wrap.setAttribute("data-pokechat", "");
    wrap.style.cssText = "position:fixed;bottom:80px;left:16px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-start;gap:8px;";

    // 任务按钮（上）——轮询时显示
    var taskBtn = el("button", "pc-btn pc-glass hidden", "任务（0）");
    taskBtn.style.cssText = "color:#0b1220;font-weight:700;";
    wrap.appendChild(taskBtn);

    // 队列 + 🎯（下）—— 对齐项目版：队列按钮带处理中 ping 点；🎯 用 lucide MousePointerClick SVG 图标
    var row = el("div", null);
    row.style.cssText = "display:flex;align-items:center;gap:8px;";
    var queueBtn = el("button", "pc-btn pc-btn-primary pc-glass", "反馈队列");
    queueBtn.style.cssText = "background:var(--pc-primary);color:#fff;border-radius:999px;padding:8px 14px;font-weight:700;font-size:12px;";
    queueBtn.onclick = function () {
      qOpen = !qOpen;
      if (qOpen) closeAllDialogs("queue");  // 打开对话时关闭其他弹窗（2026-08-22 互斥）
      renderQueueDialog();
    };
    var qDot = el("span", null);
    qDot.style.cssText = "display:none;width:8px;height:8px;border-radius:50%;background:#fbbf24;box-shadow:0 0 0 0 rgba(251,191,36,.5);animation:pc-ping 1.5s cubic-bezier(0,0,.2,1) infinite;margin-left:4px;";
    qDot.setAttribute("data-pc-qdot", "");
    queueBtn.appendChild(qDot);
    var pickBtn = el("button", "pc-glass", null);
    pickBtn.setAttribute("data-pc-pickbtn", "");
    pickBtn.style.cssText = "position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:12px;box-shadow:0 8px 20px rgba(0,0,0,.4);transition:transform .15s;";
    // 2026-08-22 用户要求：100% 对齐 trade 项目代码
    //   {picking ? <X className="h-5 w-5 text-primary" /> : <MousePointerClick className="h-5 w-5 text-primary" />}
    // 选择模式激活时显示 X（20px），未激活显示 MousePointerClick（20px）
    var MPC_PATHS = '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>';
    var X_PATHS = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';
    function renderPickIcon() {
      pickBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (picking ? X_PATHS : MPC_PATHS) + '</svg>';
      pickBtn.querySelector("svg").style.color = "var(--pc-primary)";
    }
    renderPickIcon();
    window.__pcRenderPickIcon = renderPickIcon;  // startPicking/stopPicking 里同步图标
    pickBtn.title = "选择组件（Ctrl+F）";
    pickBtn.onclick = function () { picking ? stopPicking() : startPicking(); renderPickIcon(); };
    pickBtn.onmouseenter = function () { pickBtn.style.transform = "scale(1.05)"; };
    pickBtn.onmouseleave = function () { pickBtn.style.transform = ""; };
    row.appendChild(queueBtn); row.appendChild(pickBtn);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
    if (!document.getElementById("pc-ping-kf")) {
      var pk = document.createElement("style");
      pk.id = "pc-ping-kf";
      pk.textContent = "@keyframes pc-ping { 75%,100% { box-shadow:0 0 0 6px rgba(251,191,36,0); } }";
      document.head.appendChild(pk);
    }

    // 任务提示条（右下角，任务进行中提示）
    var taskBar = el("div", "pc-glass hidden");
    taskBar.setAttribute("data-pokechat", "taskbar");
    taskBar.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99989;padding:8px 14px;font-size:12px;color:#fbbf24;display:flex;align-items:center;gap:8px;";
    taskBar.innerHTML = '<span class="pc-spin" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(251,191,36,.3);border-top-color:#fbbf24;border-radius:50%;animation:pc-spin 1s linear infinite;"></span><span data-pc-task-text>任务处理中…</span>';
    document.body.appendChild(taskBar);
    if (!document.getElementById("pc-spin-kf")) {
      var kf = document.createElement("style");
      kf.id = "pc-spin-kf";
      kf.textContent = "@keyframes pc-spin { to { transform: rotate(360deg); } }";
      document.head.appendChild(kf);
    }

    // 备注弹窗
    buildNoteDialog();
    // 编辑弹窗
    buildEditDialog();
    // 队列对话大弹窗
    buildQueueDialog();
    // 滚动智能跟随：「回到底部」按钮（2026-08-22 用户要求）
    setupScrollBtn(document.querySelector("[data-pokechat='queue']"));
  }

  function buildNoteDialog() {
    var m = el("div", "pc-modal hidden");
    m.setAttribute("data-pokechat", "note");
    // z-index 3002：高于 edit(3001) 和 queue(3000)——IM 窗口开着时组件反馈弹窗叠加在其上（2026-08-22）
    m.style.cssText = "position:fixed;inset:0;z-index:2147483002;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
    m.onclick = function (e) { if (e.target === m) closeNoteDialog(); };
    // 组件反馈弹窗：白底深字（2026-08-22 用户反馈看不清；与编辑弹窗同款，保持玻璃圆角风格）
    m.innerHTML =
      '<div style="width:672px;max-width:94vw;padding:20px;border-radius:16px;' +
      '  background:linear-gradient(162deg, rgba(255,255,255,.20), rgba(255,255,255,.10));' +
      '  border:1px solid rgba(255,255,255,.25); box-shadow:0 12px 30px rgba(0,0,0,.35);' +
      '  backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); color:hsl(222 47% 8%);">' +
      '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '    <span style="font-weight:700;font-size:14px;color:hsl(222 47% 10%);">组件反馈</span>' +
      '    <button data-pc-close style="background:none;border:none;color:hsl(222 20% 35%);cursor:pointer;padding:4px;display:flex;" title="取消">' +
      '      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
      '    </button>' +
      '  </div>' +
      '  <div style="margin-bottom:8px;background:rgba(255,255,255,.55);border-radius:9px;padding:8px 10px;font-size:11px;color:hsl(222 25% 30%);line-height:1.6;">' +
      '    <div>页面：<span style="font-family:monospace;color:hsl(222 45% 12%);font-weight:600;" data-pc-path></span></div>' +
      '    <div>组件：<span style="font-family:monospace;color:hsl(222 45% 12%);font-weight:600;" data-pc-sel></span></div>' +
      '    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title=""><span>内容：</span><span data-pc-txt></span></div>' +
      '  </div>' +
      '  <textarea data-pc-note rows="6" placeholder="备注：想怎么改？（如：把这里改成红色、加个筛选按钮…）Enter 提交，Shift+Enter 换行" style="margin-bottom:8px;resize:none;width:100%;box-sizing:border-box;' +
      '    background:rgba(255,255,255,.75); color:hsl(222 45% 12%); border:1px solid rgba(0,0,0,.15); border-radius:9px; padding:8px 10px; font-size:13px; outline:none;"></textarea>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;">' +
      '    <button data-pc-cancel style="background:none;border:none;color:hsl(222 20% 35%);cursor:pointer;padding:6px 12px;font-size:13px;">取消</button>' +
      '    <button data-pc-sendd style="border:1px solid hsl(15 89% 56% / .6);color:hsl(15 80% 45%);background:rgba(255,255,255,.5);border-radius:9px;padding:6px 12px;cursor:pointer;font-size:13px;" title="Ctrl+Enter">直接发送（Ctrl+Enter）</button>' +
      '    <button data-pc-add style="background:hsl(15 89% 56%);color:#fff;font-weight:600;border:none;border-radius:9px;padding:6px 14px;cursor:pointer;font-size:13px;" title="Enter">加入队列（Enter）</button>' +
      '  </div>' +
      '</div>';
    $("[data-pc-cancel]", m).onclick = closeNoteDialog;
    $("[data-pc-close]", m).onclick = closeNoteDialog;
    $("[data-pc-add]", m).onclick = addToQueue;
    $("[data-pc-sendd]", m).onclick = sendDirectFromDialog;
    function syncBtns() {  // 对齐项目版 disabled 逻辑：备注为空时两个提交按钮禁用
      var has = note.trim().length > 0;
      $("[data-pc-add]", m).disabled = !has;
      $("[data-pc-sendd]", m).disabled = !has;
      $("[data-pc-add]", m).style.opacity = has ? "1" : ".5";
      $("[data-pc-sendd]", m).style.opacity = has ? "1" : ".5";
    }
    var ta = $("[data-pc-note]", m);
    ta.addEventListener("input", function () { note = ta.value; syncBtns(); });
    ta.addEventListener("keydown", function (e) {
      // ⚠️ 2026-08-22 修复：原生 JS 用 e.isComposing（e.nativeEvent 是 React 合成事件属性，
      // 在原生事件里恒为 undefined，导致 IME 输入法按 Enter 确认候选词时误触发"加入队列"→弹窗消失）
      if (e.isComposing || e.keyCode === 229) return;
      var elNode = ta;
      if (e.key === "Home") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) elNode.selectionStart = elNode.selectionEnd = 0;
        else { var ls = elNode.value.lastIndexOf("\n", elNode.selectionStart - 1) + 1; elNode.selectionStart = elNode.selectionEnd = ls; }
      } else if (e.key === "End") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) elNode.selectionStart = elNode.selectionEnd = elNode.value.length;
        else { var nl = elNode.value.indexOf("\n", elNode.selectionStart); elNode.selectionStart = elNode.selectionEnd = nl === -1 ? elNode.value.length : nl; }
      } else if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); if (note.trim()) sendDirectFromDialog(); }
      else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) addToQueue(); }
    });
    document.body.appendChild(m);
  }

  function buildEditDialog() {
    var m = el("div", "pc-modal hidden");
    m.setAttribute("data-pokechat", "edit");
    // z-index 比 IM 窗口高 1（2026-08-22）：编辑弹窗叠加在 IM 窗口之上
    m.style.cssText = "position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
    m.onclick = function (e) { if (e.target === m) closeEdit(); };
    // 编辑弹窗卡片：稍白背景 + 深色字体（2026-08-22 用户反馈看不清；保持玻璃圆角风格不变）
    m.innerHTML =
      '<div style="width:672px;max-width:94vw;padding:20px;border-radius:16px;' +
      '  background:linear-gradient(162deg, rgba(255,255,255,.20), rgba(255,255,255,.10));' +
      '  border:1px solid rgba(255,255,255,.25); box-shadow:0 12px 30px rgba(0,0,0,.35);' +
      '  backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); color:hsl(222 47% 8%);">' +
      '  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '    <span style="font-weight:700;font-size:14px;color:hsl(222 47% 10%);">编辑队列条目</span>' +
      '    <button data-pc-close style="background:none;border:none;color:hsl(222 20% 35%);cursor:pointer;padding:4px;display:flex;" title="取消">' +
      '      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
      '    </button>' +
      '  </div>' +
      '  <div style="margin-bottom:8px;background:rgba(255,255,255,.55);border-radius:9px;padding:8px 10px;font-size:11px;color:hsl(222 25% 30%);line-height:1.6;">' +
      '    <div>页面：<span style="font-family:monospace;color:hsl(222 45% 12%);font-weight:600;" data-pc-path></span></div>' +
      '    <div>组件：<span style="font-family:monospace;color:hsl(222 45% 12%);font-weight:600;" data-pc-sel></span></div>' +
      '    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title=""><span>内容：</span><span data-pc-txt></span></div>' +
      '  </div>' +
      '  <textarea data-pc-note rows="6" placeholder="备注：想怎么改？Enter 保存 · Shift+Enter 换行" style="margin-bottom:8px;resize:none;width:100%;box-sizing:border-box;' +
      '    background:rgba(255,255,255,.75); color:hsl(222 45% 12%); border:1px solid rgba(0,0,0,.15); border-radius:9px; padding:8px 10px; font-size:13px; outline:none;"></textarea>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;">' +
      '    <button data-pc-cancel style="background:none;border:none;color:hsl(222 20% 35%);cursor:pointer;padding:6px 12px;font-size:13px;">取消</button>' +
      '    <button data-pc-save style="background:hsl(15 89% 56%);color:#fff;font-weight:600;border:none;border-radius:9px;padding:6px 14px;cursor:pointer;font-size:13px;" title="Enter">保存（Enter）</button>' +
      '  </div>' +
      '</div>';
    $("[data-pc-cancel]", m).onclick = closeEdit;
    $("[data-pc-close]", m).onclick = closeEdit;
    $("[data-pc-save]", m).onclick = saveEdit;
    var ta = $("[data-pc-note]", m);
    function syncSave() {
      var has = note.trim().length > 0;
      var save = $("[data-pc-save]", m);
      if (save) { save.disabled = !has; save.style.opacity = has ? "1" : ".5"; }
    }
    ta.addEventListener("input", function () { note = ta.value; syncSave(); });
    ta.addEventListener("keydown", function (e) {
      // 2026-08-22 修复：原生 JS 用 e.isComposing（同备注弹窗）
      if (e.isComposing || e.keyCode === 229) return;
      var elNode = ta;
      if (e.key === "Home") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) elNode.selectionStart = elNode.selectionEnd = 0;
        else { var ls = elNode.value.lastIndexOf("\n", elNode.selectionStart - 1) + 1; elNode.selectionStart = elNode.selectionEnd = ls; }
      } else if (e.key === "End") {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) elNode.selectionStart = elNode.selectionEnd = elNode.value.length;
        else { var nl = elNode.value.indexOf("\n", elNode.selectionStart); elNode.selectionStart = elNode.selectionEnd = nl === -1 ? elNode.value.length : nl; }
      } else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (note.trim()) saveEdit(); }
    });
    document.body.appendChild(m);
  }

  function buildQueueDialog() {
    var d = el("div", "pc-modal hidden");
    d.setAttribute("data-pokechat", "queue");
    d.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;padding:24px;";
    d.onclick = function (e) { if (e.target === d) { qOpen = false; d.classList.add("hidden"); } };
    // 100% 对齐项目版 IM 窗口：glass rounded-2xl h-[75vh] max-w-3xl +
    // 顶部计数 + 左索引（直接/组件分组）+ 右对话（用户右/AI 左）+ 待发送区 + 直接发送
    d.innerHTML =
      '<div class="pc-glass" style="width:883px;max-width:96vw;height:75vh;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;position:relative;">' +
      '  <div style="padding:10px 16px;border-bottom:1px solid var(--pc-border);display:flex;justify-content:space-between;align-items:center;">' +
      '    <b style="font-size:14px;">反馈对话</b>' +
      '    <div style="font-size:12px;font-weight:600;color:#f1f5f9;display:flex;gap:14px;align-items:center;">' +
      '      <span>等待 <b data-pc-n-pending style="color:#fcd34d">0</b></span>' +
      '      <span>处理中 <b data-pc-n-processing style="color:#fcd34d">0</b></span>' +
      '      <span>已完成 <b data-pc-n-done style="color:#6ee7b7">0</b></span>' +
      '      <button data-pc-dlg-close style="background:none;border:none;color:#f1f5f9;cursor:pointer;padding:2px 6px;font-size:15px;" title="关闭">✕</button>' +
      '    </div>' +
      '  </div>' +
      '  <div style="display:flex;flex:1;min-height:0;">' +
      '    <div data-pc-index style="width:176px;border-right:1px solid var(--pc-border);overflow-y:auto;padding:8px;flex-shrink:0;"></div>' +
      '    <div style="flex:1;display:flex;flex-direction:column;min-width:0;">' +
      '      <div data-pc-body style="flex:1;overflow-y:auto;padding:12px 16px;"></div>' +
      '      <div data-pc-pend style="border-top:1px solid var(--pc-border);padding:8px 12px 0;display:none;"></div>' +
      '      <button data-pc-scrollbtn style="display:none;position:absolute;right:24px;bottom:120px;z-index:20;background:hsl(15 89% 56%);color:#fff;border:none;border-radius:999px;padding:6px 14px;font-size:11px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35);">回到底部</button>' +
      '      <div style="padding:12px 16px;border-top:1px solid var(--pc-border);display:flex;gap:8px;">' +
      '        <input class="pc-input" data-pc-dmsg placeholder="直接发消息给 AI（Enter 发送）" style="flex:1;min-width:0;">' +
      '        <button class="pc-btn pc-btn-primary" data-pc-send style="padding:8px 14px;">发送</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    $("[data-pc-dlg-close]", d).onclick = function () { qOpen = false; d.classList.add("hidden"); };
    $("[data-pc-send]", d).onclick = function () { sendDirectMsg(); };
    $("[data-pc-dmsg]", d).addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDirectMsg(); } });
    $("[data-pc-dmsg]", d).addEventListener("input", function (e) { directMsg = e.target.value; });
    document.body.appendChild(d);
  }

  function sendDirectMsg() {
    var m = directMsg.trim();
    if (!m) return;
    sendFeedback([{ path: location.pathname + location.search, selector: "", text: "", note: m }]);
    directMsg = "";
    $("[data-pc-dmsg]").value = "";
  }

  function renderFloating() {
    var qb = document.querySelector("[data-pokechat] .pc-btn-primary");
    if (!qb) return;
    // 保留 ping 点节点：清空文本前先摘下来，再按需放回
    var dot = qb.querySelector("[data-pc-qdot]");
    if (dot) dot.remove();
    qb.textContent = "";
    qb.appendChild(document.createTextNode(queue.length ? "反馈队列（" + queue.length + "）" : "反馈队列"));
    if (dot) qb.appendChild(dot);
    var running = (status.pending ? status.pending.length : 0) + (status.processing ? status.processing.length : 0);
    if (dot) dot.style.display = running > 0 ? "inline-block" : "none";
  }

  function renderQueueDialog() {
    var d = document.querySelector("[data-pokechat='queue']");
    if (!d) return;
    if (!qOpen) { d.classList.add("hidden"); return; }
    d.classList.remove("hidden");
    var p = status.pending.length, pr = status.processing.length, dn = status.done.length;
    $("[data-pc-n-pending]", d).textContent = p;
    $("[data-pc-n-processing]", d).textContent = pr;
    $("[data-pc-n-done]", d).textContent = dn;

    // 索引（直接对话 / 组件对话，新在上）
    var idx = $("[data-pc-index]", d);
    idx.innerHTML = "";
    var convo = status.done.concat(status.processing, status.pending).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)); });
    var direct = convo.filter(function (x) { return !x.selector; });
    var comp = convo.filter(function (x) { return !!x.selector; });
    function renderIdx(title, list) {
      // 2026-08-22 用户要求：分组标题显示实时数量（直接对话 N / 组件对话 N）
      idx.appendChild(el("div", null, "<div style='font-size:10px;font-weight:700;color:var(--pc-text);margin:8px 0 4px;text-transform:uppercase;'>" + title + " <span style='color:#fcd34d;font-size:10px;'>(" + list.length + ")</span></div>"));
      if (!list.length) idx.appendChild(el("p", null, "<span style='font-size:11px;color:rgba(148,163,184,.4)'>无</span>"));
      list.forEach(function (it) {
        var b = el("button", "pc-btn", null);
        b.style.cssText = "display:block;width:100%;text-align:left;font-size:11px;padding:5px 8px;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        var st = it.conclusion ? "done" : (status.processing.indexOf(it) >= 0 ? "processing" : "pending");
        // 2026-08-22 修复：组件反馈条目索引始终显示组件信息（selector），note 作为次要附注——
        // 之前 note 优先导致有 note 时组件选择器信息被吞
        var idxLabel = it.selector ? (it.note ? it.selector + "：" + it.note : it.selector)
          : (it.note || it.text || it.path);
        b.innerHTML = "<span style='display:inline-block;width:6px;height:6px;border-radius:50%;background:" +
          (st === "done" ? "var(--pc-green)" : st === "processing" ? "var(--pc-amber)" : "var(--pc-muted)") + ";margin-right:5px;'></span>" + esc(idxLabel);
        b.onclick = function () { var bd = $("[data-pc-body]", d); var t = bd.querySelector('[data-msg="' + it.ts + '"]'); if (t) t.scrollIntoView({ behavior: "smooth", block: "center" }); };
        idx.appendChild(b);
      });
    }
    renderIdx("直接对话", direct);
    renderIdx("组件对话", comp);

    // 对话体（用户右 / AI 左，自动滚底）——100% 对齐项目版：
    // 用户消息右侧带状态徽标；AI 回复左侧带 AI 徽标 + 时间戳；待发送区独立在输入框上方
    var body = $("[data-pc-body]", d);
    body.innerHTML = "";
    var convo2 = status.done.concat(status.processing, status.pending).sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    if (!convo2.length && !queue.length) {
      body.innerHTML = "<p style='text-align:center;color:var(--pc-muted);padding:50px 0;font-size:13px'>暂无记录，点 🎯 选个组件试试</p>";
    }
    // 待发送区（独立条，在发送框上方）
    var pend = $("[data-pc-pend]", d);
    if (queue.length) {
      pend.style.display = "block";
      pend.innerHTML =
        "<div style='font-size:11px;font-weight:700;color:var(--pc-muted);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;'>" +
        "  <span>待发送（" + queue.length + "）</span>" +
        "  <span><button class='pc-btn' data-pc-clear style='font-size:10px;padding:2px 10px;background:none;color:var(--pc-muted);'>清空</button>" +
        "  <button class='pc-btn pc-btn-primary' data-pc-sendq style='font-size:10px;padding:2px 10px;'>发送给 AI（" + queue.length + "）</button></span>" +
        "</div>" +
        "<div style='display:flex;flex-wrap:wrap;gap:6px;padding-bottom:8px;'>" +
        queue.map(function (q) {
          return "<button data-pc-qchip='" + q.ts + "' style='max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(255,255,255,.07);border:1px solid var(--pc-border);border-radius:999px;padding:3px 10px;font-size:11px;cursor:pointer;color:var(--pc-text);'>" + esc(q.note || q.selector || q.path) + "</button>";
        }).join("") +
        "</div>";
      $("[data-pc-clear]", pend).onclick = clearQueue;
      $("[data-pc-sendq]", pend).onclick = sendQueue;
      queue.forEach(function (q) {
        var chip = $("[data-pc-qchip='" + q.ts + "']", pend);
        if (chip) chip.onclick = function () { openEdit(q); };
      });
    } else {
      pend.style.display = "none";
      pend.innerHTML = "";
    }
    convo2.forEach(function (it) {
      var st = it.conclusion ? "done" : (status.processing.indexOf(it) >= 0 ? "processing" : "pending");
      var wrap = el("div", null);
      wrap.setAttribute("data-msg", it.ts);
      wrap.style.marginBottom = "10px";
      var stLabel = st === "done" ? "已完成" : st === "processing" ? "处理中" : "等待";
      var stCls = st === "done" ? "pc-badge-done" : st === "processing" ? "pc-badge-proc" : "pc-badge-wait";
      var tsStr = String(it.ts || "");
      var time = tsStr.length >= 12 ? tsStr.slice(8, 10) + ":" + tsStr.slice(10, 12) : "";
      // 用户（右，圆角右上小）——对齐项目版 bg-secondary/25 + 状态徽标
      wrap.innerHTML =
        "<div style='display:flex;justify-content:flex-end;'>" +
        "  <div style='max-width:75%;background:rgba(255,255,255,.07);border-radius:16px 16px 2px 16px;padding:8px 12px;font-size:12px;'>" +
        "    <div style='font-weight:600;font-size:11px;'>" + esc(it.text || it.selector) + "</div>" +
        "    <div style='margin-top:2px;color:var(--pc-text);'>" + esc(it.note) + "</div>" +
        "    <span class='pc-badge " + stCls + "' style='margin-top:5px;display:inline-block;'>" + stLabel + "</span>" +
        "  </div>" +
        "</div>" +
        // AI（左，主色淡橙 + AI 徽标 + 时间戳）——对齐项目版 bg-primary/10 + 时间
        "<div style='display:flex;justify-content:flex-start;margin-top:5px;'>" +
        "  <div style='max-width:75%;background:hsl(15 89% 56% / .10);border-radius:16px 16px 16px 2px;padding:8px 12px;font-size:12px;color:var(--pc-text);white-space:pre-wrap;word-break:break-word;'>" +
        "    <div style='margin-bottom:3px;display:flex;align-items:center;gap:6px;'>" +
        "      <span style='background:hsl(15 89% 56% / .15);border-radius:4px;padding:1px 5px;font-size:9px;font-weight:700;color:var(--pc-primary);'>AI</span>" +
        "      <span style='font-family:monospace;font-size:10px;color:var(--pc-muted-2);'>" + time + "</span>" +
        "    </div>" +
        (st === "done" ? esc(it.conclusion || "已处理完成") : st === "processing" ? "处理中…" : "等待调度，1 分钟内开始处理") +
        "  </div>" +
        "</div>";
      body.appendChild(wrap);
    });
    // 2026-08-22 用户要求：滚动查看历史时新消息不强制跳底（打断阅读），
    // 仅当用户已在底部时自动跟随；离开底部显示「回到底部」按钮
    var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    if (nearBottom) {
      body.scrollTop = body.scrollHeight;
      var sb = $("[data-pc-scrollbtn]", d);
      if (sb) sb.style.display = "none";
    } else {
      var sb2 = $("[data-pc-scrollbtn]", d);
      if (sb2) sb2.style.display = "block";
    }
  }

  function setupScrollBtn(d) {
    var body = $("[data-pc-body]", d);
    var btn = $("[data-pc-scrollbtn]", d);
    if (!body || !btn) return;
    body.addEventListener("scroll", function () {
      var nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
      btn.style.display = nearBottom ? "none" : "block";
    });
    btn.onclick = function () {
      body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
      btn.style.display = "none";
    };
  }

  function toast(msg) {
    var t = el("div", "pc-glass", null);
    t.setAttribute("data-pokechat", "");
    t.style.cssText = "position:fixed;bottom:140px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:8px 16px;font-size:13px;background:rgba(17,28,46,.92);";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
  }

  /* ================= 任务提示（轮询后端时显示） ================= */
  var taskTimer = null;
  function startTaskPolling() {
    if (!hasBackend() || taskTimer) return;
    taskTimer = setInterval(function () {
      fetch(api("/status")).then(function (r) { return r.json(); })
        .then(function (d) {
          var running = d.pending.length + d.processing.length;
          var bar = document.querySelector("[data-pokechat='taskbar']");
          if (bar) {
            if (running > 0) { bar.classList.remove("hidden"); $("[data-pc-task-text]", bar).textContent = "任务处理中（等待 " + d.pending.length + " · 处理中 " + d.processing.length + "）"; }
            else bar.classList.add("hidden");
          }
          if (JSON.stringify(d) !== JSON.stringify(status)) { status = d; renderQueueDialog(); }
        }).catch(function () {});
    }, 5000);
  }

  /* ================= 初始化（兼容第三方项目：DOM 未就绪时等待，2026-08-22） ================= */
  function doInit(config) {
    cfg = Object.assign({ endpoint: DEFAULT_ENDPOINT, apiPrefix: "/api/feedback" }, config || {});
    loadQueue();
    buildUI();
    renderFloating();
    refreshStatus();
    startTaskPolling();
    setInterval(function () { refreshStatus(); }, 10000);
  }
  global.PokeChat = {
    init: function (config) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { doInit(config); });
      } else {
        doInit(config);
      }
    },
    open: function () { qOpen = true; renderQueueDialog(); },
  };
})(window);
