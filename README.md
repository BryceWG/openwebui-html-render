# OpenWebUI HTML Renderer

一个给 OpenWebUI 使用的 Tampermonkey / 油猴用户脚本。可以把模型直接输出的裸 HTML 文本块渲染成可视化内容，增加内容可读性。

## 效果预览

![效果预览](./images/preview.png)

## 功能

- 识别 OpenWebUI 消息里作为文本节点出现的 `<div>...</div>`、`<table>...</table>` 等 HTML 片段。
- 支持 HTML 块前置 `<style>...</style>`。
- 渲染成功后隐藏原始 HTML 文本，页面只显示预览效果。
- 支持流式输出：HTML 片段闭合后会自动渲染，未完成的半截 HTML 会继续保持原文。
- 渲染块右上角提供三个按钮：复制为 PNG 图像、下载 SVG、复制 HTML 源码。
- 总开关：`HTML 渲染当前已开启/已关闭，点击切换`。

## 安装

1. 安装 Tampermonkey、Violentmonkey 或其他兼容用户脚本管理器。
2. 打开 [openwebui-html-renderer.user.js](./openwebui-html-renderer.user.js)。
3. 将脚本内容复制到用户脚本管理器，保存启用。
4. 进入 OpenWebUI 页面后刷新一次。

把脚本头部的 `@match` 改成你的地址：

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
