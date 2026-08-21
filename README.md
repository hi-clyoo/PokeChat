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

### React / Vue / 任何框架

`pokechat.js` 是**框架无关**的原生 DOM 实现，直接 `<script>` 引入后 `PokeChat.init()` 即可，不依赖框架运行时。

## 🖥 后端接口

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/feedback` | POST | `{items:[{path,selector,text,note}]}` 批量提交，落盘 `data/` |
| `/api/feedback/status` | GET | `{pending,processing,done}` 状态（done 条目带 `conclusion` 回复） |

AI 处理端可轮询 `/api/feedback/status` 取 `pending`，处理完把文件移到 `processing/` → 加 `conclusion` → 移到 `done/`（前端对话面板自动显示）。

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
