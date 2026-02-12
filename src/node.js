import { BLOCK_ELEMENTS } from "./constants.js";
import { toHTML } from "./serialize.js";

export class Node {
  constructor(name, { attrs = null, data = null, namespace = null } = {}) {
    this.name = name;
    this.parent = null;
    this.namespace = namespace;
    this.originOffset = null;
    this.originLine = null;
    this.originCol = null;
    this.data = data;
    this.attrs = attrs;
    this.children = [];
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
    if (!node) {
      return;
    }
    const container = getChildContainer(this);
    const last = container.children[container.children.length - 1];
    if (last && last.name === "#text" && node.name === "#text") {
      last.data = `${last.data || ""}${node.data || ""}`;
      return;
    }
    container.children.push(node);
    node.parent = container;
  }

  removeChild(node) {
    const container = getChildContainer(this);
    const index = container.children.indexOf(node);
    if (index >= 0) {
      container.children.splice(index, 1);
      node.parent = null;
    }
  }

  insertBefore(node, referenceNode) {
    const container = getChildContainer(this);
    if (referenceNode == null) {
      this.appendChild(node);
      return;
    }
    const index = container.children.indexOf(referenceNode);
    if (index < 0) {
      throw new Error("Reference node is not a child of this node");
    }
    if (node.name === "#text") {
      const prev = index > 0 ? container.children[index - 1] : null;
      const next = container.children[index] || null;
      if (prev && prev.name === "#text") {
        prev.data = `${prev.data || ""}${node.data || ""}`;
        if (next && next.name === "#text") {
          prev.data = `${prev.data || ""}${next.data || ""}`;
          container.removeChild(next);
        }
        return;
      }
      if (next && next.name === "#text") {
        next.data = `${node.data || ""}${next.data || ""}`;
        return;
      }
    }

    container.children.splice(index, 0, node);
    node.parent = container;
  }

  replaceChild(newNode, oldNode) {
    const container = getChildContainer(this);
    const index = container.children.indexOf(oldNode);
    if (index < 0) {
      throw new Error("The node to be replaced is not a child of this node");
    }
    container.children[index] = newNode;
    newNode.parent = container;
    oldNode.parent = null;
    return oldNode;
  }

  hasChildNodes() {
    return getChildContainer(this).children.length > 0;
  }

  cloneNode(deep = false) {
    const clone = createNodeLike(this);
    if (deep) {
      for (const child of this.children) {
        clone.appendChild(child.cloneNode(true));
      }
      if (clone.templateContent && this.templateContent) {
        clone.templateContent = this.templateContent.cloneNode(true);
      }
    }
    return clone;
  }

  query(selector) {
    const matcher = buildSelectorMatcher(selector);
    const out = [];
    const stack = [...this.children].reverse();

    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (matcher(node)) {
        out.push(node);
      }
      if (node.templateContent) {
        for (let i = node.templateContent.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.templateContent.children[i]);
        }
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
    }
    return out;
  }

  queryOne(selector) {
    const matcher = buildSelectorMatcher(selector);
    const stack = [...this.children].reverse();

    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (matcher(node)) {
        return node;
      }
      if (node.templateContent) {
        for (let i = node.templateContent.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.templateContent.children[i]);
        }
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
    }

    return null;
  }

  toHTML(options = {}) {
    return toHTML(this, options);
  }

  to_html(options = {}) {
    return this.toHTML(options);
  }

  toText({ separator = " ", strip = true, separatorBlocksOnly = false } = {}) {
    const parts = [];
    const stack = [this];
    let lastWasBlock = false;

    while (stack.length) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if (node.name === "#text") {
        const raw = node.data || "";
        const text = strip ? raw.trim() : raw;
        if (text) {
          if (separatorBlocksOnly && parts.length && lastWasBlock) {
            parts.push(separator);
          } else if (!separatorBlocksOnly && parts.length) {
            parts.push(separator);
          }
          parts.push(text);
          lastWasBlock = false;
        }
        continue;
      }

      if (!node.name.startsWith("#") && BLOCK_ELEMENTS.has(node.name)) {
        lastWasBlock = true;
      }

      if (node.templateContent) {
        for (let i = node.templateContent.children.length - 1; i >= 0; i -= 1) {
          stack.push(node.templateContent.children[i]);
        }
      }
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        stack.push(node.children[i]);
      }
    }

    return parts.join("");
  }

  to_text(options = {}) {
    return this.toText(options);
  }

  query_one(selector) {
    return this.queryOne(selector);
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
    super(String(name).toLowerCase(), { attrs: attrs || {}, namespace });
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

export class Doctype extends Node {
  constructor(name = "html", publicId = null, systemId = null) {
    super("!doctype", { data: { name, publicId, systemId } });
  }
}

function createNodeLike(node) {
  if (node instanceof Document) {
    return new Document();
  }
  if (node instanceof DocumentFragment) {
    return new DocumentFragment();
  }
  if (node instanceof Template) {
    return new Template(node.name, node.attrs ? { ...node.attrs } : {}, node.namespace);
  }
  if (node instanceof Element) {
    return new Element(node.name, node.attrs ? { ...node.attrs } : {}, node.namespace);
  }
  if (node instanceof Text) {
    return new Text(node.data || "");
  }
  if (node instanceof Comment) {
    return new Comment(node.data || "");
  }
  if (node instanceof Doctype) {
    return new Doctype(node.data?.name || "html", node.data?.publicId || null, node.data?.systemId || null);
  }
  return new Node(node.name, {
    attrs: node.attrs ? { ...node.attrs } : null,
    data: node.data,
    namespace: node.namespace
  });
}

function getChildContainer(node) {
  if (node && node.name === "template" && node.templateContent) {
    return node.templateContent;
  }
  return node;
}

function buildSelectorMatcher(selector) {
  const raw = String(selector || "").trim();
  if (!raw) {
    throw new Error("Empty selector");
  }

  if (raw === "*") {
    return (node) => !node.name.startsWith("#") && node.name !== "!doctype";
  }

  const match = /^(?:([a-zA-Z][a-zA-Z0-9_-]*)|)(?:#([a-zA-Z][a-zA-Z0-9_-]*))?(?:\.([a-zA-Z][a-zA-Z0-9_-]*))?$/.exec(raw);
  if (!match) {
    throw new Error(`Unsupported selector: ${selector}`);
  }

  const tag = match[1] ? match[1].toLowerCase() : null;
  const id = match[2] || null;
  const className = match[3] || null;

  return (node) => {
    if (node.name.startsWith("#") || node.name === "!doctype") {
      return false;
    }
    if (tag && node.name !== tag) {
      return false;
    }
    if (id && node.attrs?.id !== id) {
      return false;
    }
    if (className) {
      const classes = (node.attrs?.class || "").split(/\s+/).filter(Boolean);
      if (!classes.includes(className)) {
        return false;
      }
    }
    return true;
  };
}
