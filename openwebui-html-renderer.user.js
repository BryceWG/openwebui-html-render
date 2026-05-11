// ==UserScript==
// @name         OpenWebUI HTML Renderer
// @namespace    https://openwebui.com/
// @version      1.1.0
// @description  Render plain HTML text blocks in OpenWebUI messages.
// @author       local
// @match        http://localhost:3000/*
// @match        http://127.0.0.1:3000/*
// @match        https://owu.xxxx/*
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ROOT_CLASS = 'owui-html-renderer';
  const SOURCE_CLASS = 'owui-html-renderer-source';
  const ENABLED_KEY = 'owuiHtmlRenderer.enabled';
  const enabled = GM_getValue(ENABLED_KEY, true);
  const ignoredTextNodes = new WeakSet();
  const pendingRoots = new Set();

  GM_addStyle(`
    .${ROOT_CLASS} {
      position: relative;
      margin: 12px 0;
      padding: 12px;
      overflow: auto;
      border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
      border-radius: 8px;
      background: Canvas;
    }

    .${SOURCE_CLASS} {
      display: none !important;
    }

    .${ROOT_CLASS}__tools {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      gap: 6px;
      opacity: 0;
      transition: opacity 120ms ease;
      z-index: 1;
    }

    .${ROOT_CLASS}:hover .${ROOT_CLASS}__tools,
    .${ROOT_CLASS}__tools:focus-within {
      opacity: 1;
    }

    .${ROOT_CLASS}__button {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
      border-radius: 7px;
      background: color-mix(in srgb, Canvas 94%, currentColor 6%);
      color: inherit;
      cursor: pointer;
    }

    .${ROOT_CLASS}__button:hover {
      background: color-mix(in srgb, Canvas 86%, currentColor 14%);
    }

    .${ROOT_CLASS}__button svg {
      width: 17px;
      height: 17px;
      pointer-events: none;
    }
  `);

  GM_registerMenuCommand(`HTML 渲染当前${enabled ? '已开启' : '已关闭'}，点击切换`, () => {
    GM_setValue(ENABLED_KEY, !enabled);
    location.reload();
  });

  if (!enabled) return;

  const flushScan = debounce(scanPendingRoots, 120);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'characterData') {
        ignoredTextNodes.delete(mutation.target);
        queueScan(mutation.target);
        return;
      }

      mutation.addedNodes.forEach(queueScan);
    });

    flushScan();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  scanRoot(document.body);

  function queueScan(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      pendingRoots.add(node);
    } else if (node.nodeType === Node.ELEMENT_NODE && !shouldSkip(node)) {
      pendingRoots.add(node);
    }
  }

  function scanPendingRoots() {
    const roots = [...pendingRoots];
    pendingRoots.clear();
    roots.filter((root) => !hasQueuedAncestor(root, roots)).forEach(scanRoot);
  }

  function scanRoot(root) {
    const nodes = [];

    if (root.nodeType === Node.TEXT_NODE) {
      if (acceptTextNode(root)) nodes.push(root);
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return acceptTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });

      while (walker.nextNode()) {
        nodes.push(walker.currentNode);
      }
    }

    nodes.forEach(renderTextNode);
  }

  function acceptTextNode(node) {
    if (ignoredTextNodes.has(node)) return false;

    const parent = node.parentElement;
    if (!parent || shouldSkip(parent)) return false;

    if (extractHtml(node.nodeValue || '')) return true;

    ignoredTextNodes.add(node);
    return false;
  }

  function hasQueuedAncestor(root, roots) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE) return false;

    const parent = root.parentNode;
    return roots.some((other) => other !== root && other.nodeType === Node.ELEMENT_NODE && parent && other.contains(parent));
  }

  function renderTextNode(textNode) {
    const stylePrefix = collectStylePrefix(textNode);
    const html = `${stylePrefix.html}${extractHtml(textNode.nodeValue || '')}`;
    const parent = textNode.parentNode;
    if (!html || !parent) return;

    const source = document.createElement('span');
    source.className = SOURCE_CLASS;
    source.textContent = textNode.nodeValue || '';

    const wrapper = document.createElement('section');
    wrapper.className = ROOT_CLASS;

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const sanitized = sanitize(html);
    shadow.append(baseStyle(), htmlFragment(sanitized));

    wrapper.append(makeTools(wrapper, host, sanitized, html));
    wrapper.append(host);

    parent.replaceChild(source, textNode);
    stylePrefix.nodes.forEach(hideSourceNode);
    source.after(wrapper);
  }

  function makeTools(wrapper, host, sanitizedHtml, sourceHtml) {
    const tools = document.createElement('div');
    tools.className = `${ROOT_CLASS}__tools`;

    const copyImageButton = makeToolButton('复制图像', imageIcon());
    copyImageButton.addEventListener('click', async () => {
      await withButtonStatus(copyImageButton, () => copyRenderedImage(wrapper, host, sanitizedHtml));
    });

    const downloadSvgButton = makeToolButton('下载 SVG', downloadIcon());
    downloadSvgButton.addEventListener('click', async () => {
      await withButtonStatus(downloadSvgButton, () => downloadRenderedSvg(host, sanitizedHtml));
    });

    const copySourceButton = makeToolButton('复制源码', codeIcon());
    copySourceButton.addEventListener('click', async () => {
      await withButtonStatus(copySourceButton, () => copyText(sourceHtml));
    });

    tools.append(copyImageButton, downloadSvgButton, copySourceButton);
    return tools;
  }

  function makeToolButton(title, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${ROOT_CLASS}__button`;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    return button;
  }

  async function withButtonStatus(button, action) {
    const title = button.title;
    button.disabled = true;

    try {
      await action();
      button.title = '已复制';
      button.setAttribute('aria-label', '已复制');
    } catch (error) {
      console.error('[OpenWebUI HTML Renderer]', error);
      button.title = '复制失败';
      button.setAttribute('aria-label', '复制失败');
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.title = title;
        button.setAttribute('aria-label', title);
      }, 1000);
    }
  }

  async function copyText(text) {
    await navigator.clipboard.writeText(text);
  }

  async function copyRenderedImage(wrapper, host, sanitizedHtml) {
    if (!window.ClipboardItem) throw new Error('当前浏览器不支持复制 PNG 到剪贴板');

    const rect = host.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (!width || !height) throw new Error('渲染内容尺寸为空');

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const svg = buildSvgDocument(sanitizedHtml, width, height, scale);

    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(wrapper).backgroundColor || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('生成 PNG 失败');

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  async function downloadRenderedSvg(host, sanitizedHtml) {
    const rect = host.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (!width || !height) throw new Error('渲染内容尺寸为空');

    const svg = buildSvgDocument(sanitizedHtml, width, height, 1);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `openwebui-html-${new Date().toISOString().replace(/[:.]/g, '-')}.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function buildSvgDocument(sanitizedHtml, width, height, scale) {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">
        <foreignObject width="100%" height="100%">
          ${buildImageHtml(sanitizedHtml, width)}
        </foreignObject>
      </svg>
    `;
  }

  function buildImageHtml(sanitizedHtml, width) {
    const container = document.createElement('div');
    container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    container.style.width = `${width}px`;
    container.style.background = '#ffffff';
    container.append(baseStyle(), htmlFragment(sanitizedHtml));
    return new XMLSerializer().serializeToString(container);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function imageIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  }

  function codeIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>';
  }

  function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  }

  function collectStylePrefix(textNode) {
    const nodes = [];
    let html = '';
    let node = previousMeaningfulSibling(textNode) || previousMeaningfulSibling(textNode.parentElement);

    while (node) {
      const styleHtml = extractStyleBlocks(node);
      if (!styleHtml) break;

      nodes.unshift(node);
      html = `${styleHtml}${html}`;
      node = previousMeaningfulSibling(node);
    }

    return { html, nodes };
  }

  function previousMeaningfulSibling(node) {
    if (!node) return null;

    let current = node.previousSibling;

    while (current) {
      if (current.nodeType === Node.COMMENT_NODE) {
        current = current.previousSibling;
        continue;
      }

      if (current.nodeType === Node.TEXT_NODE && !current.nodeValue.trim()) {
        current = current.previousSibling;
        continue;
      }

      if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains(SOURCE_CLASS)) {
        current = current.previousSibling;
        continue;
      }

      return current;
    }

    return null;
  }

  function extractStyleBlocks(text) {
    const source = decodeEntities(text.nodeType === Node.TEXT_NODE ? text.nodeValue || '' : text.textContent || '').trim();
    const match = source.match(/^(?:\s*<style\b[^>]*>[\s\S]*?<\/style>\s*)+$/i);
    return match ? source : '';
  }

  function hideSourceNode(node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      node.classList.add(SOURCE_CLASS);
      return;
    }

    const parent = node.parentNode;
    if (!parent) return;

    const source = document.createElement('span');
    source.className = SOURCE_CLASS;
    source.textContent = node.nodeValue || '';
    parent.replaceChild(source, node);
  }

  function shouldSkip(element) {
    return Boolean(
      element.closest(`.${ROOT_CLASS}, .${SOURCE_CLASS}, pre, code, textarea, input, select, script, style, noscript`) ||
        element.closest('[contenteditable="true"], [role="textbox"]')
    );
  }

  function extractHtml(text) {
    const raw = text.replace(/\r\n?/g, '\n').trim();
    if (raw.length < 24 || raw.length > 50000) return '';
    if (!raw.includes('<') && !raw.includes('&lt;')) return '';
    if (!raw.includes('>') && !raw.includes('&gt;')) return '';

    const source = decodeEntities(raw).trim();
    if (source.length < 24 || source.length > 50000) return '';

    const open = source.match(/<(div|section|article|main|aside|header|footer|table|ul|ol|p|span|h[1-6]|details|blockquote|figure|svg|canvas)\b[^>]*>/i);
    if (!open || open.index === undefined) return '';

    const start = open.index;
    const renderStart = findStylePrefixStart(source, start);
    const tag = open[1].toLowerCase();
    const tagPattern = new RegExp(`<\\/?${escapeRegExp(tag)}\\b[^>]*>`, 'gi');
    tagPattern.lastIndex = start;

    let depth = 0;
    let match;

    while ((match = tagPattern.exec(source))) {
      const token = match[0];
      if (/^<\//.test(token)) {
        depth -= 1;
      } else if (!/\/>$/.test(token)) {
        depth += 1;
      }

      if (depth === 0) {
        const html = source.slice(renderStart, match.index + token.length).trim();
        return looksLikeHtml(html) ? html : '';
      }
    }

    return '';
  }

  function looksLikeHtml(html) {
    return /<[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(html) && /<([a-z][\w:-]*)(?:\s[^<>]*)?>[\s\S]*<\/\1>/i.test(html);
  }

  function findStylePrefixStart(source, rootStart) {
    const prefix = source.slice(0, rootStart);
    const stylePrefix = prefix.match(/(?:\s*<style\b[^>]*>[\s\S]*?<\/style>\s*)+$/i);
    return stylePrefix ? rootStart - stylePrefix[0].length : rootStart;
  }

  function sanitize(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, object, embed, link, meta, base, form, input, button, textarea, select, option').forEach((node) => node.remove());

    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();

        if (/^on/i.test(name) || name === 'srcdoc' || name === 'autofocus') {
          node.removeAttribute(attr.name);
          return;
        }

        if (['href', 'src', 'xlink:href'].includes(name) && !isSafeUrl(value, name)) {
          node.removeAttribute(attr.name);
          return;
        }

        if (name === 'style' && /(?:expression\s*\(|behavior\s*:|-moz-binding|javascript\s*:|@import|url\s*\()/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      });
    });

    return template.innerHTML;
  }

  function isSafeUrl(value, attrName) {
    if (!value || value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true;

    try {
      const url = new URL(value, location.href);
      if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) return true;
      return attrName === 'src' && url.protocol === 'data:' && /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(value);
    } catch {
      return false;
    }
  }

  function htmlFragment(html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    return container;
  }

  function baseStyle() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        display: block;
        color: #111827;
        font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      img, svg, video, canvas, iframe {
        max-width: 100%;
      }

      table {
        border-collapse: collapse;
      }
    `;
    return style;
  }

  function decodeEntities(text) {
    if (!/[&][a-z#0-9]+;/i.test(text)) return text.replace(/\r\n?/g, '\n');

    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value.replace(/\r\n?/g, '\n');
  }

  function debounce(fn, delay) {
    let timer = 0;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
