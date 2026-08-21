/* PokeChat —— 组件选择反馈对话（零依赖，原生 JS）
 *
 * 用法：<script src="pokechat.js"></script>
 *       PokeChat.init({ endpoint: "http://127.0.0.1:8123" });  // 后端地址（可选，不配则纯本地模式）
 *
 * 功能：
 *   1. 左下角 🎯 按钮 → 选择模式（悬停虚线高亮）→ 点击组件 → 写备注 → 加入队列
 *   2. 队列悬浮常驻（localStorage 持久化，刷新不丢）
 *   3. 发送给 AI（有 endpoint 时 POST；否则本地记录）
 *   4. 对话面板（IM 式：左 AI 回复 / 右用户消息），轮询后端状态
 */
(function (global) {
  "use strict";

  var DEFAULT_ENDPOINT = ""; // 空 = 本地模式（无 AI）
  var QUEUE_KEY = "pokechat-queue";

  var cfg = { endpoint: DEFAULT_ENDPOINT };
  var queue = [];
  var picking = false;
  var picked = null;
  var status = { pending: [], processing: [], done: [] };
  var panelOpen = false;
  var dialogOpen = false;
  var selectedEl = null;
  var note = "";
  var directMsg = "";

  /* ---------------- 工具 ---------------- */
  function loadQueue() {
    try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]") || []; }
    catch (e) { queue = []; }
  }
  function saveQueue() {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  }
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

  /* ---------------- 选择模式 ---------------- */
  function pickInfo(elNode) {
    var cls = Array.prototype.slice.call(elNode.classList || []).slice(0, 3).join(".");
    var txt = (elNode.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return {
      tag: elNode.tagName.toLowerCase(),
      selector: (elNode.tagName.toLowerCase() + (elNode.id ? "#" + elNode.id : "") + (cls ? "." + cls : "")),
      text: txt,
    };
  }
  function startPicking() {
    if (picking) return;
    picking = true;
    document.body.classList.add("pokechat-picking");
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onCtx, true);
    document.addEventListener("keydown", onKey, true);
  }
  function stopPicking() {
    if (!picking) return;
    picking = false;
    document.body.classList.remove("pokechat-picking");
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onCtx, true);
    document.removeEventListener("keydown", onKey, true);
    clearOutline();
  }
  function clearOutline() {
    if (selectedEl) { selectedEl.style.outline = ""; selectedEl = null; }
  }
  function onOver(e) {
    var t = e.target;
    if (!t || t.closest("[data-pokechat]")) return;
    clearOutline();
    selectedEl = t;
    t.style.outline = "2px dashed hsl(214 90% 60%)";
    t.style.outlineOffset = "1px";
  }
  function onClick(e) {
    var t = e.target;
    if (!t || t.closest("[data-pokechat]")) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    var info = pickInfo(t);
    stopPicking();
    selectedEl = t;
    t.style.outline = "2px solid #22c55e";
    openNoteDialog(info);
  }
  function onCtx(e) { e.preventDefault(); stopPicking(); }
  function onKey(e) {
    if (e.key === "Escape") { stopPicking(); }
    else if (e.key === "f" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); picking ? stopPicking() : startPicking(); }
  }

  /* ---------------- 备注弹窗 ---------------- */
  function openNoteDialog(info) {
    picked = info;
    note = "";
    var overlay = $("[data-pokechat='note']");
    $("[data-pc-path]", overlay).textContent = location.pathname + location.search;
    $("[data-pc-sel]", overlay).textContent = info.selector;
    $("[data-pc-txt]", overlay).textContent = info.text || "（无文本）";
    $("[data-pc-note]", overlay).value = "";
    overlay.classList.remove("hidden");
    $("[data-pc-note]", overlay).focus();
  }
  function closeNoteDialog() {
    $("[data-pokechat='note']").classList.add("hidden");
    picked = null;
    clearOutline();
  }
  function addToQueue() {
    if (!picked || !note.trim()) return;
    queue.push({ path: location.pathname + location.search, selector: picked.selector, text: picked.text, note: note, ts: Date.now() });
    saveQueue();
    renderQueueBadge();
    closeNoteDialog();
  }
  function sendDirect() {
    var m = directMsg.trim();
    if (!m) return;
    if (cfg.endpoint) {
      post(cfg.endpoint + "/api/feedback", { items: [{ path: location.pathname + location.search, selector: "", text: "", note: m }] }, function () { refreshStatus(); });
    } else {
      queue.push({ path: location.pathname + location.search, selector: "", text: "", note: m, ts: Date.now(), local: true });
      saveQueue(); renderQueueBadge();
    }
    directMsg = "";
    $("[data-pc-dmsg]").value = "";
  }

  /* ---------------- 后端 ---------------- */
  function post(url, body, cb) {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(cb).catch(function () { /* 静默 */ });
  }
  function refreshStatus() {
    if (!cfg.endpoint) return;
    fetch(cfg.endpoint + "/api/feedback/status").then(function (r) { return r.json(); })
      .then(function (d) { status = d; renderDialog(); }).catch(function () {});
  }

  /* ---------------- UI ---------------- */
  function buildUI() {
    var css = document.createElement("style");
    css.textContent = [
      ".pokechat-picking, .pokechat-picking * { cursor: crosshair !important; }",
      ".pokechat-picking *:hover { outline: 1px dashed hsl(214 90% 60% / .55) !important; outline-offset: 1px; }",
      ".pokechat-picking *:hover:not(:has(*:hover)) { outline: 2px solid hsl(214 90% 60%) !important; outline-offset: 1px; }",
      "[data-pokechat] { font-family: system-ui, sans-serif; }",
      "[data-pokechat] .pc-btn { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }",
      "[data-pokechat] .pc-btn-primary { background: #2563eb; color: #fff; border-color: #2563eb; }",
      "[data-pokechat] .pc-input, [data-pokechat] .pc-textarea { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px; padding: 8px; font-size: 13px; width: 100%; box-sizing: border-box; }",
      "[data-pokechat] .pc-modal { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; }",
      "[data-pokechat] .pc-panel { background: #0f172a; color: #e2e8f0; border: 1px solid #1e293b; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.4); }",
      "[data-pokechat] .hidden { display: none !important; }",
    ].join("\n");
    document.head.appendChild(css);

    // 悬浮区：任务队列按钮（常驻）
    var wrap = el("div", null);
    wrap.setAttribute("data-pokechat", "");
    wrap.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:99990;display:flex;align-items:center;gap:8px;";
    var pickBtn = el("button", "pc-btn", "🎯");
    pickBtn.title = "选择组件（Ctrl+F）";
    pickBtn.onclick = function () { picking ? stopPicking() : startPicking(); };
    var queueBtn = el("button", "pc-btn pc-btn-primary", "反馈队列");
    queueBtn.onclick = function () { panelOpen = !panelOpen; renderQueuePanel(); };
    wrap.appendChild(pickBtn); wrap.appendChild(queueBtn);
    document.body.appendChild(wrap);

    // 队列面板
    var panel = el("div", "pc-panel hidden");
    panel.setAttribute("data-pokechat", "panel");
    panel.style.cssText = "position:fixed;bottom:64px;left:16px;z-index:99991;width:320px;max-height:60vh;overflow-y:auto;padding:12px;";
    document.body.appendChild(panel);

    // 备注弹窗
    var noteModal = el("div", "pc-modal hidden");
    noteModal.setAttribute("data-pokechat", "note");
    noteModal.onclick = function (e) { if (e.target === noteModal) closeNoteDialog(); };
    noteModal.innerHTML =
      '<div class="pc-panel" style="width:520px;max-width:90vw;padding:16px;">' +
      '  <div style="font-weight:700;margin-bottom:10px;">组件反馈</div>' +
      '  <div style="font-size:11px;color:#94a3b8;background:#1e293b;border-radius:8px;padding:8px;margin-bottom:10px;">' +
      '    页面：<b style="color:#e2e8f0" data-pc-path></b><br>组件：<b style="color:#e2e8f0" data-pc-sel></b><br>内容：<span data-pc-txt></span>' +
      '  </div>' +
      '  <textarea class="pc-textarea" data-pc-note rows="4" placeholder="备注：想怎么改？Enter 加入队列，Shift+Enter 换行"></textarea>' +
      '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px;">' +
      '    <button class="pc-btn" data-pc-cancel>取消</button>' +
      '    <button class="pc-btn pc-btn-primary" data-pc-add>加入队列（Enter）</button>' +
      '  </div>' +
      '</div>';
    $("[data-pc-cancel]", noteModal).onclick = closeNoteDialog;
    $("[data-pc-add]", noteModal).onclick = addToQueue;
    $("[data-pc-note]", noteModal).addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addToQueue(); }
    });
    document.body.appendChild(noteModal);

    // 对话大弹窗（IM）
    var dlg = el("div", "pc-modal hidden");
    dlg.setAttribute("data-pokechat", "dialog");
    dlg.onclick = function (e) { if (e.target === dlg) { dialogOpen = false; dlg.classList.add("hidden"); } };
    dlg.innerHTML =
      '<div class="pc-panel" style="width:900px;max-width:95vw;height:70vh;display:flex;flex-direction:column;">' +
      '  <div style="padding:10px 14px;border-bottom:1px solid #1e293b;display:flex;justify-content:space-between;align-items:center;">' +
      '    <b>反馈对话</b>' +
      '    <div style="font-size:12px;color:#94a3b8;display:flex;gap:12px;">' +
      '      <span>等待 <b id="pc-n-pending" style="color:#f59e0b">0</b></span>' +
      '      <span>处理中 <b id="pc-n-processing" style="color:#fbbf24">0</b></span>' +
      '      <span>已完成 <b id="pc-n-done" style="color:#34d399">0</b></span>' +
      '      <button class="pc-btn" id="pc-dlg-close" style="padding:2px 8px;">✕</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="pc-dlg-body" style="flex:1;overflow-y:auto;padding:12px 14px;"></div>' +
      '  <div style="padding:10px 14px;border-top:1px solid #1e293b;display:flex;gap:8px;">' +
      '    <input class="pc-input" data-pc-dmsg placeholder="直接发消息给 AI（Enter 发送）">' +
      '    <button class="pc-btn pc-btn-primary" data-pc-send>发送</button>' +
      '  </div>' +
      '</div>';
    $("[data-pc-send]", dlg).onclick = sendDirect;
    $("[data-pc-dmsg]", dlg).addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDirect(); }
    });
    $("[data-pc-dmsg]", dlg).addEventListener("input", function (e) { directMsg = e.target.value; });
    $("#pc-dlg-close", dlg).onclick = function () { dialogOpen = false; dlg.classList.add("hidden"); };
    document.body.appendChild(dlg);

    // 打开对话：点队列按钮打开面板里的「打开对话」
    queueBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); openDialog(); });
  }

  function renderQueueBadge() {
    var btn = document.querySelector("[data-pokechat] .pc-btn-primary");
    if (btn) btn.textContent = queue.length ? "反馈队列（" + queue.length + "）" : "反馈队列";
  }

  function renderQueuePanel() {
    var panel = document.querySelector("[data-pokechat='panel']");
    if (!panelOpen) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    panel.innerHTML = "";
    panel.appendChild(el("div", null, "<b style='font-size:13px'>待发送（" + queue.length + "）</b>" +
      "<button class='pc-btn' style='float:right;font-size:11px;padding:2px 8px;' data-pc-clear>清空</button>" +
      "<button class='pc-btn pc-btn-primary' style='float:right;margin-right:6px;font-size:11px;padding:2px 8px;' data-pc-sendq>发送" + (cfg.endpoint ? "给 AI" : "（本地）") + "</button>" +
      "<button class='pc-btn' style='float:right;margin-right:6px;font-size:11px;padding:2px 8px;' data-pc-dialog>打开对话</button>"));
    $("[data-pc-clear]", panel).onclick = function () { queue = []; saveQueue(); renderQueueBadge(); renderQueuePanel(); };
    $("[data-pc-sendq]", panel).onclick = function () {
      if (!cfg.endpoint) { alert("本地模式：未配置后端 endpoint，队列已保存在本地 localStorage"); return; }
      post(cfg.endpoint + "/api/feedback", { items: queue.map(function (q) { return { path: q.path, selector: q.selector, text: q.text, note: q.note }; }) }, function () {
        queue = []; saveQueue(); renderQueueBadge(); renderQueuePanel(); refreshStatus();
      });
    };
    $("[data-pc-dialog]", panel).onclick = openDialog;
    if (queue.length === 0) {
      panel.appendChild(el("p", null, "<span style='font-size:12px;color:#64748b'>暂无数据，点 🎯 选个组件试试</span>"));
    }
    queue.forEach(function (q, i) {
      var item = el("div", null);
      item.style.cssText = "background:#1e293b;border-radius:8px;padding:6px 8px;margin-top:6px;font-size:12px;";
      item.innerHTML = "<div style='color:#cbd5e1;'>" + esc(q.note) + "</div>" +
        "<div style='color:#64748b;font-size:10px;'>" + esc(q.selector || q.path) + "</div>";
      panel.appendChild(item);
    });
  }

  function openDialog() {
    dialogOpen = true;
    var dlg = document.querySelector("[data-pokechat='dialog']");
    dlg.classList.remove("hidden");
    refreshStatus();
  }

  function renderDialog() {
    if (!dialogOpen) return;
    var dlg = document.querySelector("[data-pokechat='dialog']");
    $("#pc-n-pending", dlg).textContent = status.pending.length;
    $("#pc-n-processing", dlg).textContent = status.processing.length;
    $("#pc-n-done", dlg).textContent = status.done.length;
    var body = $("#pc-dlg-body", dlg);
    body.innerHTML = "";
    var convo = status.done.concat(status.processing, status.pending)
      .sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    if (convo.length === 0) {
      body.innerHTML = "<p style='text-align:center;color:#64748b;padding:40px 0;font-size:13px'>暂无记录，用 🎯 选个组件试试</p>";
      return;
    }
    convo.forEach(function (it) {
      var st = it.conclusion ? "done" : (status.processing.indexOf(it) >= 0 ? "processing" : "pending");
      var row = el("div", null);
      row.style.marginBottom = "10px";
      row.innerHTML =
        "<div style='display:flex;justify-content:flex-end;'>" +
        "  <div style='max-width:70%;background:#1e293b;border-radius:10px 10px 2px 10px;padding:8px 10px;font-size:12px;'>" +
        "    <div style='font-weight:600;'>" + esc(it.text || it.selector) + "</div>" +
        "    <div style='margin-top:2px;'>" + esc(it.note) + "</div>" +
        "  </div>" +
        "</div>" +
        "<div style='display:flex;justify-content:flex-start;margin-top:4px;'>" +
        "  <div style='max-width:70%;background:#1d4ed8;color:#dbeafe;border-radius:10px 10px 10px 2px;padding:8px 10px;font-size:12px;'>" +
        "    <b style='font-size:10px;'>AI</b> " + (st === "done" ? esc(it.conclusion || "已处理完成") : st === "processing" ? "处理中…" : "等待调度") +
        "  </div>" +
        "</div>";
      body.appendChild(row);
    });
    body.scrollTop = body.scrollHeight;
  }

  /* ---------------- 初始化 ---------------- */
  global.PokeChat = {
    init: function (config) {
      cfg = Object.assign({ endpoint: DEFAULT_ENDPOINT }, config || {});
      loadQueue();
      buildUI();
      renderQueueBadge();
      setInterval(function () { refreshStatus(); }, 10000);
    },
    open: openDialog,
  };
})(window);
