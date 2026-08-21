# PokeChat

组件选择反馈对话 —— 点选页面组件 → 写备注 → 发给 AI → 对话式查看回复。

类似浏览器 DevTools 的元素选择器 + IM 对话，**零依赖、无需安装**，下载即可用。

## 快速开始（无需安装）

1. 下载本目录（`index.html` + `pokechat.js`），用浏览器打开 `index.html`
2. 左下角 **🎯** 进入选择模式 → 悬停组件虚线高亮 → 点击 → 写备注 → 加入队列
3. 点「反馈队列」→ 发送（本地模式仅记录在 localStorage；配后端后发给 AI）
4. **Ctrl+F** 快捷开关选择模式，**右键**退出

> 纯前端可用：队列/对话持久化在 localStorage，刷新不丢。

## 接入你自己的页面

```html
<script src="pokechat.js"></script>
<script>
  PokeChat.init({
    endpoint: "http://127.0.0.1:8123",  // 可选：配后端后发送给 AI 并轮询回复
  });
</script>
```

## 后端（可选，零依赖）

不想配后端？跳过。要 AI 回复/多人协作时用：

```bash
python3 server.py            # http://127.0.0.1:8123，纯 Python 标准库
```

接口：
- `POST /api/feedback` — `{items:[{path,selector,text,note}]}` 落盘
- `GET /api/feedback/status` — `{pending,processing,done}`（AI 处理后可给 done 条目加 `conclusion` 字段显示回复）

## 配置

| 配置 | 说明 |
|---|---|
| `endpoint` | 后端地址（空 = 本地模式） |
| `storageKey` | localStorage key（默认 `pokechat-queue`） |

## 集成到现有项目

- **React/Vue 等框架**：引入 `pokechat.js` 后调用 `PokeChat.init()` 即可（原生 DOM 实现，框架无关）
- **弹窗样式**：全部内联，可自行覆盖（类名带 `pc-` 前缀）

## 开源协议

MIT
