import { RAWTEXT_ELEMENTS } from "./constants.js";
import { ParseError } from "./errors.js";

export const TokenKind = Object.freeze({
  START_TAG: "start_tag",
  END_TAG: "end_tag",
  TEXT: "text",
  COMMENT: "comment",
  DOCTYPE: "doctype"
});

export function tokenizeHTML(html, { collectErrors = false } = {}) {
  const tokens = [];
  const errors = [];

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      emitText(html.slice(i), i, tokens);
      break;
    }

    if (lt > i) {
      emitText(html.slice(i, lt), i, tokens);
    }

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end < 0) {
        emitError(errors, collectErrors, "eof-in-comment", "Unexpected EOF in comment", lt, html);
        tokens.push({ kind: TokenKind.COMMENT, data: html.slice(lt + 4), pos: lt });
        break;
      }
      tokens.push({ kind: TokenKind.COMMENT, data: html.slice(lt + 4, end), pos: lt });
      i = end + 3;
      continue;
    }

    if (/^<!doctype\b/i.test(html.slice(lt, lt + 10))) {
      const end = html.indexOf(">", lt + 2);
      if (end < 0) {
        emitError(errors, collectErrors, "eof-in-doctype", "Unexpected EOF in doctype", lt, html);
        break;
      }
      const chunk = html.slice(lt, end + 1);
      const parts = chunk.replace(/[<>]/g, "").trim().split(/\s+/);
      const name = (parts[1] || "html").toLowerCase();
      tokens.push({ kind: TokenKind.DOCTYPE, name, publicId: null, systemId: null, pos: lt });
      i = end + 1;
      continue;
    }

    const end = html.indexOf(">", lt + 1);
    if (end < 0) {
      emitError(errors, collectErrors, "eof-in-tag", "Unexpected EOF in tag", lt, html);
      emitText(html.slice(lt), lt, tokens);
      break;
    }

    const rawTag = html.slice(lt + 1, end).trim();
    if (!rawTag) {
      i = end + 1;
      continue;
    }

    if (rawTag[0] === "!") {
      emitText(html.slice(lt, end + 1), lt, tokens);
      i = end + 1;
      continue;
    }

    if (rawTag.startsWith("/")) {
      const name = rawTag.slice(1).trim().toLowerCase();
      tokens.push({ kind: TokenKind.END_TAG, name, pos: lt });
      i = end + 1;
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const body = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceIdx = body.search(/\s/);
    const name = (spaceIdx < 0 ? body : body.slice(0, spaceIdx)).toLowerCase();
    const attrRaw = spaceIdx < 0 ? "" : body.slice(spaceIdx + 1);
    const attrs = parseAttrs(attrRaw);
    tokens.push({ kind: TokenKind.START_TAG, name, attrs, selfClosing, pos: lt });
    i = end + 1;

    if (!selfClosing && RAWTEXT_ELEMENTS.has(name)) {
      const closing = `</${name}>`;
      const lower = html.toLowerCase();
      const closeIdx = lower.indexOf(closing, i);
      if (closeIdx < 0) {
        const remaining = html.slice(i);
        if (remaining) {
          emitText(remaining, i, tokens);
        }
        emitError(errors, collectErrors, "expected-closing-tag-but-got-eof", `Expected </${name}> before EOF`, i, html);
        break;
      }

      const rawText = html.slice(i, closeIdx);
      if (rawText) {
        emitText(rawText, i, tokens, true);
      }
      tokens.push({ kind: TokenKind.END_TAG, name, pos: closeIdx });
      i = closeIdx + closing.length;
    }
  }

  return { tokens, errors };
}

function emitText(text, pos, tokens, preserveEntities = false) {
  if (!text) {
    return;
  }
  tokens.push({ kind: TokenKind.TEXT, data: preserveEntities ? text : decodeEntities(text), pos });
}

function emitError(errors, collectErrors, code, message, pos, html) {
  if (!collectErrors) {
    return;
  }
  const { line, column } = toLineCol(html, pos);
  errors.push(new ParseError(message, { category: "tokenizer", code, line, column }));
}

function parseAttrs(raw) {
  const attrs = {};
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attrPattern.exec(raw)) !== null) {
    const key = match[1].toLowerCase();
    const value = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    attrs[key] = value;
  }
  return attrs;
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function toLineCol(text, offset) {
  const chunk = text.slice(0, Math.max(0, offset));
  const parts = chunk.split("\n");
  return {
    line: parts.length,
    column: parts[parts.length - 1].length + 1
  };
}
