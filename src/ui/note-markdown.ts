// @file: src/ui/note-markdown.ts
// @feature: notes
// @tables: none
// @candidates: none
// @toc: types | logic:inlines | logic:blocks | ui:inlines | ui:blocks

// === @section:types ===
export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; code: string }
  | { type: 'link'; text: string; url: string };

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code_block'; language?: string; code: string }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] };

export type MdNode = BlockNode;

// === @section:logic:inlines ===
const SAFE_URL_REGEX = /^https?:\/\/[^\s<>'"]+$/i;

export function isSafeHttpUrl(url: string): boolean {
  if (!url) return false;
  return SAFE_URL_REGEX.test(url.trim());
}

export function parseInlines(rawText: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let pos = 0;
  const len = rawText.length;

  while (pos < len) {
    if (rawText.startsWith('`', pos)) {
      const close = rawText.indexOf('`', pos + 1);
      if (close !== -1) {
        nodes.push({ type: 'code', code: rawText.slice(pos + 1, close) });
        pos = close + 1;
        continue;
      }
    }
    if (rawText.startsWith('**', pos)) {
      const close = rawText.indexOf('**', pos + 2);
      if (close !== -1) {
        const inner = rawText.slice(pos + 2, close);
        nodes.push({ type: 'bold', children: parseInlines(inner) });
        pos = close + 2;
        continue;
      }
    }
    if (rawText.startsWith('*', pos)) {
      const close = rawText.indexOf('*', pos + 1);
      if (close !== -1) {
        const inner = rawText.slice(pos + 1, close);
        nodes.push({ type: 'italic', children: parseInlines(inner) });
        pos = close + 1;
        continue;
      }
    }
    if (rawText.startsWith('[', pos)) {
      const match = /^\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(rawText.slice(pos));
      if (match) {
        const [, linkText, linkUrl] = match;
        if (isSafeHttpUrl(linkUrl)) {
          nodes.push({ type: 'link', text: linkText, url: linkUrl.trim() });
          pos += match[0].length;
          continue;
        }
      }
    }
    const nextSpecial = rawText.slice(pos).search(/[`*[]/);
    if (nextSpecial === -1) {
      nodes.push({ type: 'text', text: rawText.slice(pos) });
      break;
    } else if (nextSpecial > 0) {
      nodes.push({ type: 'text', text: rawText.slice(pos, pos + nextSpecial) });
      pos += nextSpecial;
    } else {
      nodes.push({ type: 'text', text: rawText[pos] });
      pos += 1;
    }
  }
  return nodes;
}

// === @section:logic:blocks ===
export function parseMarkdown(src: string, depth = 0): MdNode[] {
  if (!src) return [];
  const input = depth === 0 && src.length > 20000 ? src.slice(0, 20000) : src;
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nodes: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      nodes.push({ type: 'code_block', language: lang, code: codeLines.join('\n') });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      nodes.push({ type: 'heading', level, children: parseInlines(headingMatch[2]) });
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith('>') || (lines[i].trim() && quoteLines.length > 0))) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      const children = depth < 5 ? parseMarkdown(quoteLines.join('\n'), depth + 1) : [];
      nodes.push({ type: 'blockquote', children });
      continue;
    }

    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const isOrdered = /^\d+\./.test(listMatch[2]);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const itemMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!itemMatch) break;
        items.push(parseInlines(itemMatch[3]));
        i++;
      }
      nodes.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('>') &&
      !/^(\s*)([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    nodes.push({ type: 'paragraph', children: parseInlines(paraLines.join(' ')) });
  }
  return nodes;
}

// === @section:ui:inlines ===
const BIDI_CHARS_REGEX = /[\u0590-\u05FF\uFB1D-\uFB4F\u0370-\u03FF\u1F00-\u1FFF]/;
const BIDI_TOKEN_SPLIT = /([\u0590-\u05FF\uFB1D-\uFB4F\u0370-\u03FF\u1F00-\u1FFF]+(?:\s+[\u0590-\u05FF\uFB1D-\uFB4F\u0370-\u03FF\u1F00-\u1FFF]+)*)/g;

function renderTextWithBdi(text: string, doc: Document): Node[] {
  if (!BIDI_CHARS_REGEX.test(text)) {
    return [doc.createTextNode(text)];
  }
  const parts = text.split(BIDI_TOKEN_SPLIT);
  const out: Node[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (BIDI_CHARS_REGEX.test(part)) {
      const bdi = doc.createElement('bdi');
      bdi.textContent = part;
      out.push(bdi);
    } else {
      out.push(doc.createTextNode(part));
    }
  }
  return out;
}

export function renderInlines(inlines: InlineNode[], doc: Document): Node[] {
  const result: Node[] = [];
  for (const node of inlines) {
    if (node.type === 'text') {
      result.push(...renderTextWithBdi(node.text, doc));
    } else if (node.type === 'bold') {
      const strong = doc.createElement('strong');
      renderInlines(node.children, doc).forEach((n) => strong.appendChild(n));
      result.push(strong);
    } else if (node.type === 'italic') {
      const em = doc.createElement('em');
      renderInlines(node.children, doc).forEach((n) => em.appendChild(n));
      result.push(em);
    } else if (node.type === 'code') {
      const code = doc.createElement('code');
      code.textContent = node.code;
      result.push(code);
    } else if (node.type === 'link') {
      const a = doc.createElement('a');
      a.setAttribute('href', node.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer nofollow');
      a.textContent = node.text;
      result.push(a);
    }
  }
  return result;
}

// === @section:ui:blocks ===
export function renderMarkdown(nodes: MdNode[], ownerDoc?: Document): DocumentFragment {
  const doc = ownerDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc) {
    throw new Error('renderMarkdown requires a valid DOM Document environment');
  }
  const fragment = doc.createDocumentFragment();

  for (const node of nodes) {
    if (node.type === 'heading') {
      const h = doc.createElement(`h${node.level}`);
      renderInlines(node.children, doc).forEach((n) => h.appendChild(n));
      fragment.appendChild(h);
    } else if (node.type === 'paragraph') {
      const p = doc.createElement('p');
      renderInlines(node.children, doc).forEach((n) => p.appendChild(n));
      fragment.appendChild(p);
    } else if (node.type === 'code_block') {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      if (node.language) code.className = `language-${node.language}`;
      code.textContent = node.code;
      pre.appendChild(code);
      fragment.appendChild(pre);
    } else if (node.type === 'blockquote') {
      const bq = doc.createElement('blockquote');
      const subFrag = renderMarkdown(node.children, doc);
      bq.appendChild(subFrag);
      fragment.appendChild(bq);
    } else if (node.type === 'list') {
      const listEl = doc.createElement(node.ordered ? 'ol' : 'ul');
      for (const item of node.items) {
        const li = doc.createElement('li');
        renderInlines(item, doc).forEach((n) => li.appendChild(n));
        listEl.appendChild(li);
      }
      fragment.appendChild(listEl);
    }
  }
  return fragment;
}
