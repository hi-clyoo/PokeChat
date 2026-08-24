# 🎯 PokeChat

**组件选择反馈对话** —— 像 DevTools 一样点选页面组件，写备注，发给 AI，对话式查看处理结果。

零依赖 · 无需安装 · 下载即用 · React/Vue/原生 HTML 都能接

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Language: JavaScript](https://img.shields.io/badge/language-JavaScript-yellowgreen)]()
[![Python](https://img.shields.io/badge/server-Python%20stdlib-blue)]()

---

## ✨ 功能

| 功能 | 说明 |
|---|---|
| 🎯 **组件选择模式** | 悬停虚线高亮（层级可视化）→ 点击选中组件，自动识别组件名/选择器/文案 |
| 📝 **备注弹窗** | 组件上下文自动组织（页面/选择器/内容）+ 备注，Enter 加入队列 / Ctrl+Enter 直接发送 |
| 📋 **反馈队列** | 常驻悬浮，localStorage 持久化（刷新不丢），批量发送 |
| 💬 **对话面板** | IM 式：左 AI 回复（含处理结论）、右用户消息；直接发消息；自动滚动到最新 |
| 🖥 **极简后端** | 纯 Python 标准库，`python3 server.py` 即可，无任何依赖 |

## 📦 安装指引

### 方式一：script 引入（推荐，零依赖零构建）

```html
<!-- 放在页面底部 -->
<script src="pokechat.js"></script>
<script>
  PokeChat.init({ endpoint: "http://127.0.0.1:8123" });  // 可选
</script>
```

React / Vue 项目同样适用（在 `index.html` 或组件 mount 时引入即可，原生 DOM 实现，不依赖框架）。

### 方式二：后端（可选，需要 AI 回复时）

```bash
python3 server.py            # 纯标准库，无 pip 依赖，默认 8123 端口
```

## 🤖 启动 AI loop（让反馈真正被处理）

PokeChat 前端 + 后端只负责「收集反馈」，**必须有一个 AI agent loop 轮询处理**才会回复：

```text
┌────────┐  POST /api/feedback  ┌────────┐  轮询 status   ┌──────────────┐
│ 前端页面 │ ──────────────────→ │ 后端落盘 │ ←───────────── │  AI agent loop │
│(PokeChat)│                     │ data/*.json│  取 pending    │ (Claude Code等) │
└────────┘  ←────────────────── └────────┘ ─────────────→  │  处理反馈      │
              对话面板显示回复    回写 conclusion + 移 done │  改代码/回复    │
                                                          └──────────────┘
```

**Claude Code 启动方式**（1 分钟）：

```bash
cd PokeChat
# 方式一：Claude Code 的循环任务（每 1 分钟自动检查一次）
claude --loop --prompt "
检查 data/*.json（PokeChat 反馈，排除 queue.json 和子目录）：
1. 有新反馈 → mv data/*.json data/processing/
2. 读每条（path/selector/text/note）→ 定位组件源码并修改
3. 处理完 → 移到 data/done/ 并给文件追加 conclusion 字段（完整回复）
无新反馈则简短确认
"
```

> **不启动 loop = 只有收集没有回复**（纯记录模式），这是设计如此——AI 处理不是 PokeChat 内建的。

## 🔄 数据如何交互（数据流）

| 环节 | 谁 | 做什么 | 数据位置 |
|---|---|---|---|
| 1 提交 | 前端 | `POST /api/feedback` `{items:[{path,selector,text,note}]}` | `data/{时间戳}.json`（pending） |
| 2 轮询 | AI loop | 读根目录 `*.json`（排除 queue.json） | 取 pending |
| 3 处理 | AI loop | 读备注 → 改代码/回答 | — |
| 4 标记处理中 | AI loop | `mv data/*.json data/processing/` | processing/ |
| 5 回写回复 | AI loop | 给文件加 `conclusion` 字段（完整回复） | 文件内 |
| 6 完成 | AI loop | `mv data/processing/*.json data/done/` | done/ |
| 7 展示 | 前端 | 轮询 `GET /api/feedback/status`（10s） | 对话面板显示 |

**也可以直接操作文件**（本地部署）：AI 端不调接口，直接读写 `data/` 目录（pending→processing→done + conclusion 字段），效果相同。

## 🚀 快速开始（无需安装）

```bash
# 下载本仓库（或直接下载 index.html + pokechat.js 两个文件）
git clone https://github.com/hi-clyoo/PokeChat.git
cd PokeChat

# 方式一：纯前端（零后端）
open index.html

# 方式二：配极简后端（AI 回复/多人协作）
python3 server.py          # http://127.0.0.1:8123
```

打开页面后：左下角 **🎯** → 悬停组件（虚线高亮）→ 点击 → 写备注 → 加入队列 → 发送。

> 快捷键：**Ctrl+F** 开关选择模式 · **右键** 退出 · **Enter** 加入队列 · **Shift+Enter** 换行

## 🔌 接入你自己的项目

### 原生 HTML

```html
<script src="pokechat.js"></script>
<script>
  PokeChat.init({
    endpoint: "http://127.0.0.1:8123",  // 可选：配后端后发送给 AI 并轮询回复
  });
</script>
```

### 接入 Vibe-Astock 本地后端（2026-08-22 实测）

本地后端接口是 `/api/ui-feedback` 系（不是开源 server.py 的 `/api/feedback`），
通过 `apiPrefix` + `queueApi` 对齐：

```html
<script src="/pokechat/pokechat.js"></script>
<script>
  PokeChat.init({
    endpoint: "",                        // 同源：后端就是本站
    apiPrefix: "/api/ui-feedback",       // 反馈提交/状态（开源版默认 /api/feedback）
    queueApi: "/api/ui-feedback/queue",  // 队列后端持久化（刷新不丢；不配则仅 localStorage）
  });
</script>
```

Vibe-Astock 已用此方式把内置反馈系统整体切换为 PokeChat（`frontend/index.html` 引入，
Layout 内置实现移除）。

## 🏷️ 组件标识（data-name）规范（2026-08-23）

选择组件时，PokeChat 会**向上查找最近的 `data-name` 属性**，显示在反馈弹窗「名称」行
（没有则隐藏该行）并随反馈数据提交（`name` 字段），方便 AI 精确定位组件。

`data-name` 是**通用组件标识规范**（不只是 PokeChat——测试/调试/自动化脚本都可读），
PokeChat 只是消费者之一。接入项目建议遵循：

### 命名规则

```text
模块-类型-标识
```

| 场景 | 示例 |
|---|---|
| 唯一标识（指标 key / 股票代码 / 分组名） | `si-item-hist_sideways`、`si-group-历史形态`、`paper-row-600721` |
| 循环组件（无稳定业务标识） | 用序号：`paper-row-0`、`paper-closed-row-2`、`compare-row-5`、`first-board-1` |
| 容器/区块 | `paper-stats`、`paper-holdings`、`compare-table`、`stock-news` |

### 添加规则

1. **粒度**：只给关键可交互组件 / 循环项 / 语义区块加，不需要每个元素都加——
   点选元素内部任意位置时，自动向上命中最近的 data-name
2. **唯一标识优先**：循环项有关键业务标识（指标 key、股票代码）时用业务标识；
   没有稳定标识的纯展示循环项用序号（数据变化后序号错位可接受，配合页面/内容可索引）
3. **稳定优先**：标识不含易变内容（如实时价格、时间戳），避免每次反馈都变
4. 组件删除/重命名时同步更新对应 data-name

### React 示例

```tsx
{indicators.map((it) => (
  <div key={it.key} data-name={`si-item-${it.key}`} className="card">...</div>
))}
{rows.map((r, i) => (
  <tr key={r.code} data-name={`paper-row-${i}`}>...</tr>
))}
```

### React / Vue / 任何框架

`pokechat.js` 是**框架无关**的原生 DOM 实现，直接 `<script>` 引入后 `PokeChat.init()` 即可，不依赖框架运行时。

## 🖥 后端接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/feedback` | POST | `{items:[{path,selector,text,note}]}` 批量提交，落盘 `data/` |
| `/api/feedback/status` | GET | `{pending,processing,done}` 状态（done 条目带 `conclusion` 回复） |
| `/api/feedback/<ts>/conclusion` | POST | AI 处理端回写结论 `{conclusion:"..."}`，自动移入 `done/`（pending/processing/done 位置均可回写） |

## 🤖 AI 处理端（agent / loop）接入

PokeChat 前端 + 后端负责「收集反馈」；**真正处理反馈的是 AI agent**（可以是 Claude Code、任意 LLM 工作流）。闭环需要三步：

```
用户提交 → 后端落盘(data/*.json, pending) → AI agent 轮询取到
→ 处理（改代码/回答问题）→ 回写 conclusion → 前端对话面板显示回复
```

**方式一：Claude Code（推荐，本项目的标准用法）**

开启一个每分钟的 loop 任务（`/loop 1m` 或定时任务），prompt 用：

```text
检查 PokeChat 反馈：ls data/*.json（根目录，不含子目录）。
如有新反馈：
1. mkdir -p data/processing && mv data/*.json data/processing/
2. 读取每条（path/selector/text/note——用户点选的组件 + 备注）
3. 根据备注定位组件源码并实施修改
4. 处理完：把文件移到 data/done/，并给该文件追加 conclusion 字段
   （内容 = 对用户的完整回复，多行原样保存）
若无新反馈，简短确认即可。
```

文件状态约定（前端对话面板据此显示）：
- `data/*.json` = 等待调度（pending）
- `data/processing/*.json` = 处理中
- `data/done/*.json` = 已完成（带 `conclusion` = AI 回复全文）

**方式二：任意 AI 服务 / 脚本**

轮询 `GET /api/feedback/status` 取 `pending` → 处理 → `POST /api/feedback/<ts>/conclusion` 回写结论（接口自动把文件移入 `done/`，完成状态流转）。

> 纯前端（不配 endpoint）时没有 AI 处理端，反馈只保存在 localStorage，属于"记录模式"。

## 🔧 第三方项目接入 FAQ / 排查

| 现象 | 原因 / 排查 |
|---|---|
| **UI 显示不对**（弹窗/按钮样式被改） | 项目 CSS 覆盖了 PokeChat 样式。PokeChat 所有类带 `pc-` 前缀且选择器用 `[data-pokechat]` 提升优先级；z-index 用 2147483000（最高层）。若仍被覆盖：检查项目是否有全局 `* { ... }` reset 或 transform/filter 创建了新的层叠上下文 |
| **快捷键（Ctrl+F / Enter）不生效** | 1) 项目全局 keydown 拦截并 `stopPropagation`——PokeChat 在 document capture 阶段监听，若项目在 window 级拦截可能失效；2) 页面在 **iframe / Web Components Shadow DOM** 内——document 级监听收不到内部事件；3) 焦点在项目自己的输入框时，PokeChat 的 Enter 只对弹窗内输入框生效 |
| **点击发送 / 直接发送无效** | 1) 未配置 `endpoint` 时是**本地模式**：反馈只写入 localStorage（打开反馈队列可见），不会真的发送——要 AI 处理必须配 endpoint + AI loop；2) 配了 endpoint：检查浏览器控制台 Network 里 POST `/api/feedback` 是否 200（CORS 需服务端允许跨域，本项目 server.py 已带 `Access-Control-Allow-Origin: *`）；3) 按钮被项目 CSS 遮住（z-index 低于项目元素） |
| **无 AI 回复（一直等待调度）** | **PokeChat 前端只负责收集，处理需要 AI agent loop**（Claude Code 或任意 LLM 工作流轮询 `/api/feedback/status` 处理）——详见下方「AI 处理端接入」。纯前端（无 endpoint）模式下没有 AI，属"记录模式" |
| **悬浮按钮不显示** | 检查是否在 iframe/shadow DOM 内（PokeChat 注入 `document.body`，iframe 内互不可见）；或项目 `body` 未就绪时调用 `init`（新版已自动等待 DOMContentLoaded） |

**接入检查清单**：
1. `PokeChat.init({ endpoint })` 在 DOM 就绪后调用（或直接调，新版自动等待）
2. 控制台确认无 JS 报错
3. 点 🎯 进入选择模式 → 悬停出现虚线高亮（**若没有：页面在 iframe/Shadow DOM 内**，需把 PokeChat 脚本也放进该容器）
4. 点组件弹备注 → Enter 加入队列（**若 Enter 无效：焦点在别处**，点一下输入框内再按）
5. 配了 endpoint 时点发送 → Network 里应有 POST → 状态变"等待调度"（**若没有 AI loop：一直等待，属正常**）

## ⚙️ 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `endpoint` | `""` | 后端地址；空 = 本地模式（仅 localStorage 记录） |
| `storageKey` | `"pokechat-queue"` | 队列 localStorage key |

## 📦 目录结构

```
pokechat/
├── index.html      # Demo 页（可直接打开）
├── pokechat.js     # 核心组件（原生 JS，零依赖）
├── server.py       # 极简后端（纯标准库）
├── README.md
└── LICENSE         # MIT
```

## 🤝 贡献

欢迎 PR / Issue：
- 功能建议（新的选择模式交互、面板主题等）
- Bug 修复
- 前后端集成示例（Vue/React 组件封装）

## 📄 License

[MIT](LICENSE) © hi-clyoo
