const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

export class ParseError extends Error {
  constructor(message, { category = "tokenizer", code = "parse-error", line = null, column = null } = {}) {
    super(message);
    this.name = "ParseError";
    this.category = category;
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

export class StrictModeError extends SyntaxError {
  constructor(error) {
    super(error?.message || "Strict parsing failed");
    this.name = "StrictModeError";
    this.error = error;
  }
}

export class FragmentContext {
  constructor(tagName, namespace = null) {
    this.tagName = String(tagName);
    this.namespace = namespace;
  }
}

export const HTMLContext = Object.freeze({
  HTML: "html",
  JS_STRING: "js_string",
  HTML_ATTR_VALUE: "html_attr_value",
  URL: "url"
});

export class Node {
  constructor(name, { attrs = null, data = null, namespace = null } = {}) {
    this.name = name;
    this.parent = null;
    this.namespace = namespace;
    this.originOffset = null;
    this.originLine = null;
    this.originCol = null;

    if (name === "#text" || name === "#comment" || name === "!doctype") {
      this.data = data;
      this.attrs = null;
      this.children = [];
    } else {
      this.data = data;
      this.attrs = attrs || {};
      this.children = [];
    }
  }

  get originLocation() {
    if (this.originLine == null || this.originCol == null) {
      return null;
    }
    return [this.originLine, this.originCol];
  }

  get text() {
    return this.name === "#text" ? this.data || "" : "";
  }

  appendChild(node) {
    this.children.push(node);
    node.parent = this;
  }

  removeChild(node) {
    const idx = this.children.indexOf(node);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      node.parent = null;
    }
  }

  insertBefore(node, referenceNode) {
    if (referenceNode == null) {
      this.appendChild(node);
      return;
    }
    const idx = this.children.indexOf(referenceNode);
    if (idx < 0) {
      throw new Error("Reference node is not a child of this node");
    }
    this.children.splice(idx, 0, node);
    node.parent = this;
  }

  replaceChild(newNode, oldNode) {
    const idx = this.children.indexOf(oldNode);
    if (idx < 0) {
      throw new Error("The node to be replaced is not a child of this node");
    }
    this.children[idx] = newNode;
    newNode.parent = this;
    oldNode.parent = null;
    return oldNode;
  }

  hasChildNodes() {
    return this.children.length > 0;
  }

  cloneNode(deep = false) {
    const clone = new Node(this.name, { attrs: this.attrs ? { ...this.attrs } : null, data: this.data, namespace: this.namespace });
    if (deep) {
      for (const child of this.children) {
        clone.appendChild(child.cloneNode(true));
      }
    }
    return clone;
  }

  query(selector) {
    if (!/^\*|[a-zA-Z][a-zA-Z0-9_-]*$/.test(selector)) {
      throw new Error(`Unsupported selector in phase 0: ${selector}`);
    }
    const tag = selector === "*" ? null : selector.toLowerCase();
    const matches = [];
    const stack = [...this.children].reverse();
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (!node.name.startsWith("#") && node.name !== "!doctype") {
        if (tag == null || node.name === tag) {
          matches.push(node);
        }
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
      if (node.templateContent) {
        for (let i = node.templateContent.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.templateContent.children[i]);
        }
      }
    }
    return matches;
  }

  queryOne(selector) {
    const out = this.query(selector);
    return out.length ? out[0] : null;
  }

  toText({ separator = " ", strip = true } = {}) {
    const parts = [];
    const stack = [this];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.name === "#text") {
        const raw = node.data || "";
        const value = strip ? raw.trim() : raw;
        if (value) {
          parts.push(value);
        }
      }
      if (node.children && node.children.length) {
        for (let i = node.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.children[i]);
        }
      }
      if (node.templateContent && node.templateContent.children.length) {
        for (let i = node.templateContent.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.templateContent.children[i]);
        }
      }
    }
    return parts.join(separator);
  }

  toHTML(options = {}) {
    return toHTML(this, options);
  }
}

export class Document extends Node {
  constructor() {
    super("#document");
  }
}

export class DocumentFragment extends Node {
  constructor() {
    super("#document-fragment");
  }
}

export class Element extends Node {
  constructor(name, attrs = {}, namespace = "html") {
    super(name.toLowerCase(), { attrs, namespace });
  }
}

export class Template extends Element {
  constructor(name = "template", attrs = {}, namespace = "html") {
    super(name, attrs, namespace);
    this.templateContent = namespace === "html" ? new DocumentFragment() : null;
  }
}

export class Text extends Node {
  constructor(data = "") {
    super("#text", { data });
  }
}

export class Comment extends Node {
  constructor(data = "") {
    super("#comment", { data });
  }
}

class Doctype extends Node {
  constructor(name = "html") {
    super("!doctype", { data: { name } });
  }
}

function decodeInput(input) {
  if (typeof input === "string") {
    return { text: input, encoding: null };
  }
  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    const dec = new TextDecoder("utf-8", { fatal: false });
    return { text: dec.decode(input), encoding: "utf-8" };
  }
  return { text: String(input ?? ""), encoding: null };
}

function escapeText(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttrValue(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function parseAttrs(raw) {
  const attrs = {};
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrPattern.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }
  return attrs;
}

function parseIntoRoot(html, root) {
  const stack = [root];
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      const tail = html.slice(i);
      if (tail) {
        stack[stack.length - 1].appendChild(new Text(tail));
      }
      break;
    }

    if (lt > i) {
      const text = html.slice(i, lt);
      if (text) {
        stack[stack.length - 1].appendChild(new Text(text));
      }
    }

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      const stop = end >= 0 ? end : html.length - 3;
      const data = html.slice(lt + 4, stop);
      stack[stack.length - 1].appendChild(new Comment(data));
      i = (end >= 0 ? end + 3 : html.length);
      continue;
    }

    if (/^<!doctype\b/i.test(html.slice(lt, lt + 10))) {
      const end = html.indexOf(">", lt + 2);
      const chunk = html.slice(lt, end >= 0 ? end + 1 : html.length);
      const parts = chunk.replace(/[<>]/g, "").trim().split(/\s+/);
      const name = (parts[1] || "html").toLowerCase();
      stack[stack.length - 1].appendChild(new Doctype(name));
      i = end >= 0 ? end + 1 : html.length;
      continue;
    }

    const end = html.indexOf(">", lt + 1);
    if (end < 0) {
      const rest = html.slice(lt);
      if (rest) {
        stack[stack.length - 1].appendChild(new Text(rest));
      }
      break;
    }

    const rawTag = html.slice(lt + 1, end).trim();
    if (!rawTag) {
      i = end + 1;
      continue;
    }

    if (rawTag.startsWith("/")) {
      const endName = rawTag.slice(1).trim().toLowerCase();
      while (stack.length > 1) {
        const current = stack.pop();
        if (current.name === endName) {
          break;
        }
      }
      i = end + 1;
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const tagBody = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceIdx = tagBody.search(/\s/);
    const name = (spaceIdx < 0 ? tagBody : tagBody.slice(0, spaceIdx)).toLowerCase();
    const attrRaw = spaceIdx < 0 ? "" : tagBody.slice(spaceIdx + 1);
    const attrs = parseAttrs(attrRaw);
    const el = name === "template" ? new Template(name, attrs) : new Element(name, attrs);
    stack[stack.length - 1].appendChild(el);

    if (!selfClosing && !VOID_ELEMENTS.has(name)) {
      stack.push(el);
    }
    i = end + 1;
  }
}

function parseDocument(html) {
  const root = new Document();
  parseIntoRoot(html, root);
  return root;
}

function parseDocumentFragment(html) {
  const root = new DocumentFragment();
  parseIntoRoot(html, root);
  return root;
}

export function toHTML(node, { pretty = false } = {}) {
  const _ = pretty;
  if (node.name === "#document" || node.name === "#document-fragment") {
    return node.children.map((child) => toHTML(child, { pretty: false })).join("");
  }
  if (node.name === "!doctype") {
    return `<!doctype ${node.data?.name || "html"}>`;
  }
  if (node.name === "#text") {
    return escapeText(node.data || "");
  }
  if (node.name === "#comment") {
    return `<!--${node.data || ""}-->`;
  }

  const attrs = node.attrs && Object.keys(node.attrs).length
    ? " " + Object.entries(node.attrs).map(([k, v]) => `${k}=\"${escapeAttrValue(v ?? "")}\"`).join(" ")
    : "";

  const start = `<${node.name}${attrs}>`;
  if (VOID_ELEMENTS.has(node.name)) {
    return start;
  }
  const children = node.children.map((child) => toHTML(child, { pretty: false })).join("");
  return `${start}${children}</${node.name}>`;
}

export class JustHTML {
  constructor(input, options = {}) {
    this.options = options;
    this.errors = [];

    const { text, encoding } = decodeInput(input);
    this.encoding = encoding;

    if (options.fragment || options.fragmentContext) {
      this.root = parseDocumentFragment(text);
    } else {
      this.root = parseDocument(text);
    }

    if (options.strict && this.errors.length) {
      throw new StrictModeError(this.errors[0]);
    }
  }

  query(selector) {
    return this.root.query(selector);
  }

  queryOne(selector) {
    return this.root.queryOne(selector);
  }

  toHTML(options = {}) {
    return this.root.toHTML(options);
  }

  toText(options = {}) {
    return this.root.toText(options);
  }

  static escapeJSString(value, { quote = '"' } = {}) {
    if (quote !== '"' && quote !== "'") {
      throw new Error("quote must be \" or '");
    }
    return String(value)
      .replaceAll("\\", "\\\\")
      .replaceAll(quote, `\\${quote}`)
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\t", "\\t")
      .replaceAll("<", "\\u003c")
      .replaceAll(">", "\\u003e");
  }

  static escapeAttrValue(value, { quote = '"' } = {}) {
    if (quote !== '"' && quote !== "'") {
      throw new Error("quote must be \" or '");
    }
    const escaped = String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return quote === '"' ? escaped.replaceAll('"', "&quot;") : escaped.replaceAll("'", "&#39;");
  }

  static escapeURLValue(value) {
    return encodeURI(String(value));
  }

  static escapeURLInJSString(value, options = {}) {
    return JustHTML.escapeJSString(JustHTML.escapeURLValue(value), options);
  }

  static escapeHTMLTextInJSString(value, options = {}) {
    return JustHTML.escapeJSString(escapeText(String(value)), options);
  }
}

export function parse(input, options = {}) {
  return new JustHTML(input, options);
}

export function parseFragment(input, contextOrOptions = {}) {
  if (contextOrOptions instanceof FragmentContext) {
    return new JustHTML(input, { fragmentContext: contextOrOptions });
  }
  if (contextOrOptions && typeof contextOrOptions === "object" && "tagName" in contextOrOptions) {
    return new JustHTML(input, { fragmentContext: contextOrOptions });
  }
  return new JustHTML(input, { ...contextOrOptions, fragment: true });
}

export function* stream(input, options = {}) {
  const doc = new JustHTML(input, options);
  const stack = [...doc.root.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (node.name === "#text") {
      yield ["text", node.data || ""];
      continue;
    }
    if (node.name === "#comment") {
      yield ["comment", node.data || ""];
      continue;
    }
    if (node.name === "!doctype") {
      const data = node.data || { name: "html" };
      yield ["doctype", [data.name, null, null]];
      continue;
    }
    yield ["start", [node.name, { ...(node.attrs || {}) }]];
    if (node.children.length) {
      stack.push({ _end: node.name });
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
    } else {
      yield ["end", node.name];
    }
  }
}
