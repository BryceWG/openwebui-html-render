// ==UserScript==
// @name         OpenWebUI HTML Renderer
// @namespace    https://openwebui.com/
// @version      1.2.2
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
  const MIN_HTML_LENGTH = 4;
  const MAX_HTML_LENGTH = 100000;
  const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);
  const NON_RENDERABLE_TAGS = new Set(['BASE', 'LINK', 'META', 'SCRIPT', 'STYLE', 'TEMPLATE', 'TITLE']);
  const OPTIONAL_CLOSE_TAGS = new Set(['COLGROUP', 'DD', 'DT', 'LI', 'OPTGROUP', 'OPTION', 'P', 'RB', 'RP', 'RT', 'RTC', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR']);
  const STATIC_CONTROL_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
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

    if (buildHtmlBlock(node)) return true;

    ignoredTextNodes.add(node);
    return false;
  }

  function hasQueuedAncestor(root, roots) {
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE) return false;

    const parent = root.parentNode;
    return roots.some((other) => other !== root && other.nodeType === Node.ELEMENT_NODE && parent && other.contains(parent));
  }

  function renderTextNode(textNode) {
    if (!textNode.isConnected || !textNode.parentElement || shouldSkip(textNode.parentElement)) return;

    const block = buildHtmlBlock(textNode);
    if (!block) return;

    const wrapper = document.createElement('section');
    wrapper.className = ROOT_CLASS;

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const sanitized = sanitize(block.html);
    shadow.append(baseStyle(), htmlFragment(sanitized));

    wrapper.append(makeTools(wrapper, host, sanitized, block.sourceHtml));
    wrapper.append(host);

    const anchor = hideSourceNodes(block.nodes);
    if (anchor) anchor.after(wrapper);
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

  function buildHtmlBlock(textNode) {
    const run = collectHtmlRun(textNode);
    if (!run) return null;

    const stylePrefix = collectStylePrefix(textNode);
    const sourceHtml = `${stylePrefix.html}${run.source}`;
    const html = `${stylePrefix.html}${run.html}`;
    const nodes = uniqueNodes([...stylePrefix.nodes, ...run.nodes]);

    return { html, nodes, sourceHtml };
  }
  function collectHtmlRun(startNode) {
    if (!startNode || !startNode.parentNode || hasPreviousSourceSibling(startNode)) return null;

    const firstSource = sourceText(startNode);
    if (!startsLikeHtml(stripMarkdownFence(decodeEntities(firstSource.trim())))) return null;

    const nodes = [];
    let source = '';
    let current = startNode;

    while (current && source.length <= MAX_HTML_LENGTH) {
      const chunk = sourceText(current);
      const isWhitespace = current.nodeType === Node.TEXT_NODE && !chunk.trim();

      if (current !== startNode && !isWhitespace && !looksLikeHtmlSource(chunk) && extractHtml(source)) break;
      if (!isWhitespace && !isCollectableSourceNode(current, chunk, source)) break;

      source += chunk;
      if (!isWhitespace && current.nodeType !== Node.COMMENT_NODE) nodes.push(current);

      const html = extractHtml(source);
      if (html) return { html, nodes, source };

      current = nextSourceSibling(current);
    }

    return null;
  }

  function hasPreviousSourceSibling(node) {
    let current = previousSourceSibling(node);
    while (current) {
      const text = sourceText(current);
      if (text.trim()) return startsLikeHtmlSource(text);
      current = previousSourceSibling(current);
    }

    return false;
  }

  function previousSourceSibling(node) {
    let current = node.previousSibling;
    while (current && isIgnorableRunSibling(current)) current = current.previousSibling;
    return current;
  }

  function nextSourceSibling(node) {
    let current = node.nextSibling;
    while (current && current.nodeType === Node.COMMENT_NODE) current = current.nextSibling;
    return current;
  }

  function isIgnorableRunSibling(node) {
    return (
      node.nodeType === Node.COMMENT_NODE ||
      (node.nodeType === Node.ELEMENT_NODE && (node.classList.contains(SOURCE_CLASS) || node.classList.contains(ROOT_CLASS)))
    );
  }

  function isCollectableSourceNode(node, chunk, currentSource) {
    if (node.nodeType === Node.TEXT_NODE) return true;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (shouldSkip(node)) return false;
    if (node.classList.contains(SOURCE_CLASS) || node.classList.contains(ROOT_CLASS)) return false;
    if (node.tagName === 'BR') return true;

    return Boolean(currentSource || looksLikeHtmlSource(chunk));
  }

  function sourceText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') return '\n';
    if (node.nodeType === Node.ELEMENT_NODE) return node.textContent || '';
    return '';
  }

  function looksLikeHtmlSource(text) {
    const source = decodeEntities(text).trim();
    return startsLikeHtmlSource(text) || /<\/?[a-z][\w:-]*(?:\s|>|\/)/i.test(source);
  }

  function startsLikeHtmlSource(text) {
    const source = decodeEntities(text).trim();
    return /^(?:<\/?[a-z][\w:-]*(?:\s|>|\/)|<!--|<!doctype\b|<\?xml\b)/i.test(source);
  }

  function uniqueNodes(nodes) {
    return nodes.filter((node, index) => node && nodes.indexOf(node) === index);
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
      return node;
    }

    const parent = node.parentNode;
    if (!parent) return null;

    const source = document.createElement('span');
    source.className = SOURCE_CLASS;
    source.textContent = node.nodeValue || '';
    parent.replaceChild(source, node);
    return source;
  }

  function hideSourceNodes(nodes) {
    let anchor = null;

    nodes.forEach((node) => {
      if (!node || !node.isConnected) return;
      const hidden = hideSourceNode(node);
      if (hidden) anchor = hidden;
    });

    return anchor;
  }

  function shouldSkip(element) {
    return Boolean(
      element.closest(`.${ROOT_CLASS}, .${SOURCE_CLASS}, pre, code, textarea, input, select, script, style, noscript`) ||
        element.closest('[contenteditable="true"], [role="textbox"]')
    );
  }

  function extractHtml(text) {
    const raw = text.replace(/\r\n?/g, '\n').trim();
    if (raw.length < MIN_HTML_LENGTH || raw.length > MAX_HTML_LENGTH) return '';
    if (!raw.includes('<') && !raw.includes('&lt;')) return '';
    if (!raw.includes('>') && !raw.includes('&gt;')) return '';

    const source = stripMarkdownFence(decodeEntities(raw).trim());
    if (source.length < MIN_HTML_LENGTH || source.length > MAX_HTML_LENGTH) return '';
    if (!startsLikeHtml(source)) return '';
    if (!hasBalancedHtml(source)) return '';

    const normalized = normalizeHtml(source);
    if (!normalized || !hasRenderableHtml(sanitize(normalized))) return '';

    return normalized;
  }

  function stripMarkdownFence(source) {
    const match = source.match(/^```(?:html?|xml|svg)?[^\S\n]*\n([\s\S]*?)\n```$/i);
    return match ? match[1].trim() : source;
  }

  function startsLikeHtml(source) {
    const candidate = source
      .replace(/^\s*(?:<!--[\s\S]*?-->\s*)*/, '')
      .replace(/^<\?xml\b[\s\S]*?\?>\s*/i, '')
      .trimStart();
    return /^(?:<!doctype\s+html\b[^>]*>\s*)?(?:<html\b|<head\b|<body\b|<style\b|<[a-z][\w:-]*(?:\s|>|\/>))/i.test(candidate);
  }

  function hasBalancedHtml(source) {
    const cleaned = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<!doctype\b[^>]*>/gi, '')
      .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const tagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s+(?:"[^"]*"|'[^']*'|[^'"<>])*)?\s*\/?>/g;
    const stack = [];
    let match;

    while ((match = tagPattern.exec(cleaned))) {
      const token = match[0];
      const tag = match[1].toUpperCase();
      const lowerTag = tag.toLowerCase();
      const isClosing = token.startsWith('</');
      const isSelfClosing = /\/\s*>$/.test(token) || VOID_TAGS.has(lowerTag);

      if (isClosing) {
        while (stack.length && stack[stack.length - 1] !== tag && OPTIONAL_CLOSE_TAGS.has(stack[stack.length - 1])) {
          stack.pop();
        }

        if (stack[stack.length - 1] !== tag) return false;
        stack.pop();
        continue;
      }

      while (stack.length && canAutoCloseBefore(stack[stack.length - 1], tag)) {
        stack.pop();
      }

      if (RAW_TEXT_TAGS.has(lowerTag) && !isSelfClosing) {
        const closePattern = new RegExp(`<\\/${escapeRegExp(lowerTag)}\\s*>`, 'gi');
        closePattern.lastIndex = tagPattern.lastIndex;
        const close = closePattern.exec(cleaned);
        if (!close) return false;
        tagPattern.lastIndex = close.index + close[0].length;
        continue;
      }

      if (!isSelfClosing) stack.push(tag);
    }

    while (stack.length && OPTIONAL_CLOSE_TAGS.has(stack[stack.length - 1])) {
      stack.pop();
    }

    return stack.length === 0;
  }

  function canAutoCloseBefore(openTag, nextTag) {
    if (openTag === 'P' && !['A', 'SPAN', 'STRONG', 'EM', 'B', 'I', 'U', 'SMALL', 'SUB', 'SUP', 'CODE', 'BR', 'IMG'].includes(nextTag)) return true;
    if (openTag === 'LI' && nextTag === 'LI') return true;
    if ((openTag === 'DT' || openTag === 'DD') && (nextTag === 'DT' || nextTag === 'DD')) return true;
    if ((openTag === 'TD' || openTag === 'TH') && (nextTag === 'TD' || nextTag === 'TH')) return true;
    if (openTag === 'TR' && nextTag === 'TR') return true;
    if (openTag === 'OPTION' && nextTag === 'OPTION') return true;
    if (openTag === 'OPTGROUP' && nextTag === 'OPTGROUP') return true;
    return false;
  }

  function normalizeHtml(source) {
    if (isFullDocumentHtml(source)) {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      const styles = [...doc.head.querySelectorAll('style')].map((style) => style.outerHTML).join('\n');
      const body = document.createElement('div');
      [...doc.body.attributes].forEach((attr) => body.setAttribute(attr.name, attr.value));
      body.innerHTML = doc.body.innerHTML;
      const bodyHtml = body.hasAttributes() ? body.outerHTML : doc.body.innerHTML;
      return `${styles}\n${bodyHtml}`.trim();
    }

    const template = document.createElement('template');
    template.innerHTML = source;
    return template.innerHTML.trim();
  }

  function isFullDocumentHtml(source) {
    return /^\s*(?:<!doctype\s+html\b[^>]*>\s*)?<html\b/i.test(source) || /<(?:head|body)\b/i.test(source);
  }

  function hasRenderableHtml(html) {
    if (!html.trim()) return false;

    const template = document.createElement('template');
    template.innerHTML = html;
    return hasRenderableNode(template.content);
  }

  function hasRenderableNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return Boolean(node.nodeValue.trim());
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return false;
    if (node.nodeType === Node.ELEMENT_NODE && NON_RENDERABLE_TAGS.has(node.tagName)) return false;

    if (node.nodeType === Node.ELEMENT_NODE) return true;

    return [...node.childNodes].some(hasRenderableNode);
  }

  function sanitize(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, object, embed, link, meta, base').forEach((node) => node.remove());
    template.content.querySelectorAll('form').forEach((form) => {
      const replacement = document.createElement('div');
      [...form.attributes].forEach((attr) => {
        if (!['action', 'method', 'target'].includes(attr.name.toLowerCase())) {
          replacement.setAttribute(attr.name, attr.value);
        }
      });
      while (form.firstChild) replacement.append(form.firstChild);
      form.replaceWith(replacement);
    });

    template.content.querySelectorAll('*').forEach((node) => {
      if (STATIC_CONTROL_TAGS.has(node.tagName)) {
        node.setAttribute('disabled', '');
      }

      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();

        if (
          /^on/i.test(name) ||
          name === 'srcdoc' ||
          name === 'autofocus' ||
          name === 'formaction' ||
          name === 'form'
        ) {
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
