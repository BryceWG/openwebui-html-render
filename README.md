# OpenWebUI HTML Renderer

一个给 OpenWebUI 使用的 Tampermonkey / 油猴用户脚本。它只做一件事：把模型直接输出的裸 HTML 文本块渲染成可视化内容，并隐藏原始 HTML 文本。

## 功能

- 识别 OpenWebUI / Svelte 消息里作为文本节点出现的 `<div>...</div>`、`<table>...</table>` 等 HTML 片段。
- 支持 HTML 块前置 `<style>...</style>`，样式会跟随内容放进 Shadow DOM。
- 渲染成功后隐藏原始 HTML 文本，页面只显示预览效果。
- 支持渐进渲染：流式输出尚未闭合时会临时补齐标签进行预览，后续输出继续更新同一个预览块。
- 渲染块右上角提供三个小按钮：复制为 PNG 图像、下载 SVG、复制 HTML 源码。
- 支持流式输出和历史消息，使用 `MutationObserver` 自动扫描。
- 只保留一个总开关：`HTML 渲染当前已开启/已关闭，点击切换`。
- 使用 Shadow DOM 隔离预览区样式。
- 内置基础清洗逻辑，默认移除 `script`、事件属性、危险 URL、危险 CSS 和表单控件。

## 安装

1. 安装 Tampermonkey、Violentmonkey 或其他兼容用户脚本管理器。
2. 打开 [openwebui-html-renderer.user.js](./openwebui-html-renderer.user.js)。
3. 将脚本内容复制到用户脚本管理器，保存启用。
4. 进入 OpenWebUI 页面后刷新一次。

如果之前已经安装过旧版本，请用新版内容整体覆盖旧脚本，并确认头部版本是 `1.2.0`。

如果你的 OpenWebUI 部署在其他域名，把脚本头部的 `@match` 改成你的地址：

```js
// @match https://openwebui.example.com/*
// @match http://192.168.1.20:3000/*
```

## 推荐输出格式

让模型直接输出 HTML，不需要代码块：

```html
<div style="display:flex; gap:12px;">
  <div style="border:1px solid #ddd; padding:12px;">小脑半球</div>
  <div style="border:1px solid #ddd; padding:12px;">小脑蚓部</div>
</div>
```

## 本地测试

可以在项目目录启动静态服务：

```bash
python3 -m http.server 8765
```

然后访问 `http://localhost:8765/examples/test.html`。
