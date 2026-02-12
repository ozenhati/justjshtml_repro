import { HTML_CONTEXT, VOID_ELEMENTS } from "./constants.js";

function escapeText(text) {
  return String(text || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttrValue(value, quote = '"') {
  let out = String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  if (quote === '"') {
    out = out.replaceAll('"', "&quot;");
  } else {
    out = out.replaceAll("'", "&#39;");
  }
  return out;
}

export function escapeJSString(value, quote = '"') {
  if (quote !== '"' && quote !== "'") {
    throw new Error("quote must be \" or '");
  }
  return String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll(quote, `\\${quote}`)
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function escapeURLValue(value) {
  return encodeURI(String(value || ""));
}

export function toHTML(node, options = {}) {
  const { pretty = false, indentSize = 2, context = HTML_CONTEXT.HTML, quote = '"' } = options;
  const html = pretty ? serializePretty(node, 0, indentSize) : serializeCompact(node);

  if (context === HTML_CONTEXT.HTML) {
    return html;
  }
  if (context === HTML_CONTEXT.JS_STRING) {
    return escapeJSString(html, quote);
  }
  if (context === HTML_CONTEXT.HTML_ATTR_VALUE) {
    return escapeAttrValue(html, quote);
  }
  if (context === HTML_CONTEXT.URL) {
    return escapeURLValue(node.toText ? node.toText().trim() : html.trim());
  }

  throw new Error(`Unknown serialization context: ${context}`);
}

function serializeCompact(node) {
  if (node.name === "#document" || node.name === "#document-fragment") {
    return node.children.map((child) => serializeCompact(child)).join("");
  }
  if (node.name === "#text") {
    return escapeText(node.data || "");
  }
  if (node.name === "#comment") {
    return `<!--${node.data || ""}-->`;
  }
  if (node.name === "!doctype") {
    const dt = node.data || {};
    const name = dt.name || "html";
    return `<!doctype ${name}>`;
  }

  const attrs = serializeAttrs(node.attrs || {});
  const open = `<${node.name}${attrs}>`;
  if (VOID_ELEMENTS.has(node.name)) {
    return open;
  }

  const children = node.name === "template" && node.templateContent
    ? node.templateContent.children
    : node.children;

  const body = children.map((child) => serializeCompact(child)).join("");
  return `${open}${body}</${node.name}>`;
}

function serializePretty(node, depth, indentSize) {
  if (node.name === "#document" || node.name === "#document-fragment") {
    return node.children.map((child) => serializePretty(child, depth, indentSize)).join("\n");
  }
  if (node.name === "#text") {
    return `${" ".repeat(depth * indentSize)}${escapeText(node.data || "")}`;
  }
  if (node.name === "#comment") {
    return `${" ".repeat(depth * indentSize)}<!--${node.data || ""}-->`;
  }
  if (node.name === "!doctype") {
    const dt = node.data || {};
    const name = dt.name || "html";
    return `${" ".repeat(depth * indentSize)}<!doctype ${name}>`;
  }

  const pad = " ".repeat(depth * indentSize);
  const attrs = serializeAttrs(node.attrs || {});
  const open = `${pad}<${node.name}${attrs}>`;
  if (VOID_ELEMENTS.has(node.name)) {
    return open;
  }

  const children = node.name === "template" && node.templateContent
    ? node.templateContent.children
    : node.children;

  if (!children.length) {
    return `${open}</${node.name}>`;
  }

  if (children.length === 1 && children[0].name === "#text") {
    return `${open}${escapeText(children[0].data || "")}</${node.name}>`;
  }

  const childLines = children.map((child) => serializePretty(child, depth + 1, indentSize)).join("\n");
  return `${open}\n${childLines}\n${pad}</${node.name}>`;
}

function serializeAttrs(attrs) {
  const keys = Object.keys(attrs);
  if (!keys.length) {
    return "";
  }
  return ` ${keys.map((key) => `${key}=\"${escapeAttrValue(attrs[key] ?? "", '"')}\"`).join(" ")}`;
}

export function toTestFormat(node, indent = 0) {
  const lines = [];
  renderTestFormat(node, indent, lines);
  return lines.join("\n");
}

function renderTestFormat(node, indent, lines) {
  const pad = "  ".repeat(indent);
  const prefix = `| ${pad}`;
  if (node.name === "#document" || node.name === "#document-fragment") {
    for (const child of coalesceTextNodes(node.children)) {
      renderTestFormat(child, indent, lines);
    }
    return;
  }

  if (node.name === "#text") {
    lines.push(`${prefix}"${node.data || ""}"`);
    return;
  }

  if (node.name === "#comment") {
    lines.push(`${prefix}<!-- ${node.data || ""} -->`);
    return;
  }

  if (node.name === "!doctype") {
    const name = node.data?.name ?? "html";
    const publicId = node.data?.publicId;
    const systemId = node.data?.systemId;
    if (publicId != null || systemId != null) {
      lines.push(`${prefix}<!DOCTYPE ${name} "${publicId ?? ""}" "${systemId ?? ""}">`);
    } else {
      lines.push(`${prefix}<!DOCTYPE ${name}>`);
    }
    return;
  }

  const displayName = formatForeignTagName(node);
  const ns = node.namespace && node.namespace !== "html" ? `${node.namespace} ${displayName}` : displayName;
  lines.push(`${prefix}<${ns}>`);
  const attrs = node.attrs || {};
  const formattedAttrs = Object.entries(attrs)
    .map(([key, value]) => [formatForeignAttrName(node, key), value])
    .sort((a, b) => a[0].localeCompare(b[0]));
  for (const [key, value] of formattedAttrs) {
    lines.push(`${prefix}  ${key}="${value ?? ""}"`);
  }
  for (const child of coalesceTextNodes(node.children)) {
    renderTestFormat(child, indent + 1, lines);
  }
}

function formatForeignTagName(node) {
  if (!node || node.namespace !== "svg") {
    return node?.name;
  }
  if (node.name === "foreignobject") {
    return "foreignObject";
  }
  return node.name;
}

function formatForeignAttrName(node, key) {
  if (!node || node.namespace === "html") {
    return key;
  }
  if (key.startsWith("xml:")) {
    const local = key.slice(4);
    if (local === "base" || local === "lang" || local === "space") {
      return `xml ${local}`;
    }
    return key;
  }
  if (key.startsWith("xlink:")) {
    return `xlink ${key.slice(6)}`;
  }
  if (node.namespace === "math" && key === "definitionurl") {
    return "definitionURL";
  }
  return key;
}

function coalesceTextNodes(children) {
  if (!children.length) {
    return children;
  }
  const out = [];
  for (const child of children) {
    const prev = out[out.length - 1];
    if (prev && prev.name === "#text" && child && child.name === "#text") {
      prev.data = `${prev.data || ""}${child.data || ""}`;
      continue;
    }
    if (child) {
      out.push(child);
    }
  }
  return out;
}
