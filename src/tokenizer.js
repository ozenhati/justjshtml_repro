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
      const parsed = parseComment(html, lt, errors, collectErrors);
      tokens.push({ kind: TokenKind.COMMENT, data: parsed.data, pos: lt });
      i = parsed.nextIndex;
      if (parsed.eof) {
        break;
      }
      continue;
    }

    if (/^<!doctype/i.test(html.slice(lt, lt + 10))) {
      const end = html.indexOf(">", lt + 2);
      if (end < 0) {
        emitError(errors, collectErrors, "eof-in-doctype", "Unexpected EOF in doctype", lt, html);
        break;
      }
      const chunk = html.slice(lt, end + 1);
      const dt = parseDoctype(chunk);
      tokens.push({ kind: TokenKind.DOCTYPE, name: dt.name, publicId: dt.publicId, systemId: dt.systemId, pos: lt });
      i = end + 1;
      continue;
    }

    const end = html.indexOf(">", lt + 1);
    if (end < 0) {
      if (html.startsWith("<?", lt)) {
        tokens.push({ kind: TokenKind.COMMENT, data: html.slice(lt + 1), pos: lt });
        break;
      }
      emitError(errors, collectErrors, "eof-in-tag", "Unexpected EOF in tag", lt, html);
      emitText(html.slice(lt), lt, tokens);
      break;
    }

    const rawTag = html.slice(lt + 1, end).trim();
    if (!rawTag) {
      i = end + 1;
      continue;
    }
    if (rawTag.startsWith("?")) {
      tokens.push({ kind: TokenKind.COMMENT, data: rawTag, pos: lt });
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

function parseComment(html, start, errors, collectErrors) {
  const bodyStart = start + 4;
  if (html[bodyStart] === ">" || html.startsWith("->", bodyStart)) {
    const advance = html[bodyStart] === ">" ? 1 : 2;
    return { data: "", nextIndex: bodyStart + advance, eof: false };
  }

  const endRegular = html.indexOf("-->", bodyStart);
  const endBang = html.indexOf("--!>", bodyStart);

  let end = -1;
  let markerSize = 0;
  if (endRegular >= 0 && (endBang < 0 || endRegular < endBang)) {
    end = endRegular;
    markerSize = 3;
  } else if (endBang >= 0) {
    end = endBang;
    markerSize = 4;
  }

  if (end < 0) {
    emitError(errors, collectErrors, "eof-in-comment", "Unexpected EOF in comment", start, html);
    return { data: html.slice(bodyStart), nextIndex: html.length, eof: true };
  }

  return { data: html.slice(bodyStart, end), nextIndex: end + markerSize, eof: false };
}

function parseDoctype(chunk) {
  const out = { name: "", publicId: null, systemId: null };
  let text = chunk.replace(/^<!/i, "").replace(/>$/, "");
  text = text.replace(/^doctype/i, "");

  let i = 0;
  skipSpaces();
  out.name = readUntilSpace();
  skipSpaces();

  const kw = readKeyword();
  if (kw === "public") {
    skipSpaces();
    out.publicId = readQuotedOrEmpty();
    if (out.publicId != null) {
      skipSpaces();
      out.systemId = readQuotedOrEmpty();
      if (out.systemId == null) {
        out.systemId = "";
      }
    }
  } else if (kw === "system") {
    skipSpaces();
    const sys = readQuotedOrEmpty();
    if (sys != null) {
      out.publicId = "";
      out.systemId = sys;
    }
  }

  return out;

  function skipSpaces() {
    while (i < text.length && /\s/.test(text[i])) {
      i += 1;
    }
  }

  function readUntilSpace() {
    const start = i;
    while (i < text.length && !/\s/.test(text[i])) {
      i += 1;
    }
    return text.slice(start, i).toLowerCase();
  }

  function readKeyword() {
    const save = i;
    const word = readUntilSpace().toLowerCase();
    if (word !== "public" && word !== "system") {
      i = save;
      return "";
    }
    return word;
  }

  function readQuotedOrEmpty() {
    if (i >= text.length) {
      return null;
    }
    const quote = text[i];
    if (quote !== "\"" && quote !== "'") {
      return null;
    }
    i += 1;
    const start = i;
    while (i < text.length && text[i] !== quote) {
      i += 1;
    }
    const value = text.slice(start, i);
    if (i < text.length && text[i] === quote) {
      i += 1;
    }
    return value;
  }
}
