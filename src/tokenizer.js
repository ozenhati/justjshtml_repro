import { decodeCharacterReferences } from "./entities.js";
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
  const lowerHTML = html.toLowerCase();

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

    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      if (end < 0) {
        tokens.push({ kind: TokenKind.COMMENT, data: `[CDATA[${html.slice(lt + 9)}`, pos: lt });
        break;
      }
      tokens.push({ kind: TokenKind.COMMENT, data: `[CDATA[${html.slice(lt + 9, end)}]]`, pos: lt });
      i = end + 3;
      continue;
    }

    if (html.startsWith("<!", lt)) {
      const bogusEnd = html.indexOf(">", lt + 2);
      if (bogusEnd < 0) {
        tokens.push({ kind: TokenKind.COMMENT, data: html.slice(lt + 2), pos: lt });
        break;
      }
      const bogusData = html.slice(lt + 2, bogusEnd).replaceAll("\u0000", "\ufffd");
      tokens.push({ kind: TokenKind.COMMENT, data: bogusData, pos: lt });
      i = bogusEnd + 1;
      continue;
    }

    const end = html.indexOf(">", lt + 1);
    if (end < 0) {
      if (html.startsWith("<?", lt)) {
        tokens.push({ kind: TokenKind.COMMENT, data: html.slice(lt + 1), pos: lt });
        break;
      }
      emitError(errors, collectErrors, "eof-in-tag", "Unexpected EOF in tag", lt, html);
      break;
    }

    const rawInner = html.slice(lt + 1, end);
    const rawTag = rawInner.trim();
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
      if (/^\s/.test(rawInner)) {
        emitText(html.slice(lt, end + 1), lt, tokens);
        i = end + 1;
        continue;
      }
      const endToken = parseEndTag(rawInner);
      if (endToken.kind === "comment") {
        tokens.push({ kind: TokenKind.COMMENT, data: endToken.data, pos: lt });
      } else {
        tokens.push({ kind: TokenKind.END_TAG, name: endToken.name, pos: lt });
      }
      i = end + 1;
      continue;
    }

    const parsed = parseStartTag(rawInner);
    if (!parsed || !parsed.name) {
      emitText(html.slice(lt, end + 1), lt, tokens);
      i = end + 1;
      continue;
    }
    const { name, attrs, selfClosing } = parsed;
    tokens.push({ kind: TokenKind.START_TAG, name, attrs, selfClosing, pos: lt });
    i = end + 1;

    if (!selfClosing && shouldConsumeRawText(name)) {
      const closeIdx = findRawCloseIndex(lowerHTML, i, name);
      if (closeIdx < 0) {
        const remaining = html.slice(i);
        if (remaining) {
          emitText(remaining, i, tokens, !shouldDecodeEntitiesInRaw(name));
        }
        emitError(errors, collectErrors, "expected-closing-tag-but-got-eof", `Expected </${name}> before EOF`, i, html);
        break;
      }

      const rawText = html.slice(i, closeIdx);
      if (rawText) {
        emitText(rawText, i, tokens, !shouldDecodeEntitiesInRaw(name));
      }
      tokens.push({ kind: TokenKind.END_TAG, name, pos: closeIdx });
      const closeEnd = findTagCloseIndex(html, closeIdx + 2 + name.length);
      if (closeEnd < 0) {
        break;
      }
      i = closeEnd + 1;
    }
  }

  return { tokens, errors };
}

function emitText(text, pos, tokens, preserveEntities = false) {
  if (!text) {
    return;
  }
  text = normalizeNewlines(String(text));
  const normalized = preserveEntities
    ? String(text)
    : decodeCharacterReferences(text);
  if (!normalized) {
    return;
  }
  tokens.push({ kind: TokenKind.TEXT, data: normalized, pos });
}

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
    const value = decodeCharacterReferences(match[2] ?? match[3] ?? match[4] ?? "", { inAttribute: true });
    if (!(key in attrs)) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function parseStartTag(rawInner) {
  let i = 0;
  const src = String(rawInner || "");
  while (i < src.length && /\s/.test(src[i])) {
    i += 1;
  }

  const nameStart = i;
  while (i < src.length && !/[\s/>]/.test(src[i])) {
    i += 1;
  }
  const name = src.slice(nameStart, i).toLowerCase();
  if (!name) {
    return null;
  }

  const attrs = {};
  let selfClosing = false;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) {
      i += 1;
    }
    if (i >= src.length) {
      break;
    }
    if (src[i] === "/") {
      selfClosing = true;
      i += 1;
      while (i < src.length && /\s/.test(src[i])) {
        i += 1;
      }
      continue;
    }

    const attrStart = i;
    while (i < src.length && !/[\s=>/]/.test(src[i])) {
      i += 1;
    }
    const rawKey = src.slice(attrStart, i).toLowerCase();
    if (!rawKey) {
      i += 1;
      continue;
    }

    while (i < src.length && /\s/.test(src[i])) {
      i += 1;
    }

    let value = "";
    if (src[i] === "=") {
      i += 1;
      while (i < src.length && /\s/.test(src[i])) {
        i += 1;
      }
      if (src[i] === '"' || src[i] === "'") {
        const quote = src[i];
        i += 1;
        const valueStart = i;
        while (i < src.length && src[i] !== quote) {
          i += 1;
        }
        value = src.slice(valueStart, i);
        if (src[i] === quote) {
          i += 1;
        }
      } else {
        const valueStart = i;
        while (i < src.length && !/[\s>]/.test(src[i])) {
          i += 1;
        }
        value = src.slice(valueStart, i);
      }
    }

    if (!(rawKey in attrs)) {
      attrs[rawKey] = decodeCharacterReferences(value, { inAttribute: true });
    }
  }

  return { name, attrs, selfClosing };
}

function parseEndTag(rawInner) {
  const src = String(rawInner || "");
  let i = 0;
  if (src[i] !== "/") {
    return { kind: "comment", data: src };
  }
  i += 1;
  if (/\s/.test(src[i] || "")) {
    return { kind: "comment", data: src.slice(1) };
  }
  const start = i;
  while (i < src.length && /[A-Za-z0-9:-]/.test(src[i])) {
    i += 1;
  }
  const name = src.slice(start, i).toLowerCase();
  if (!name) {
    return { kind: "comment", data: src.slice(1) };
  }
  return { kind: "end_tag", name };
}

function shouldConsumeRawText(tagName) {
  return tagName === "script" ||
    tagName === "style" ||
    tagName === "xmp" ||
    tagName === "iframe" ||
    tagName === "noembed" ||
    tagName === "noframes" ||
    tagName === "plaintext" ||
    tagName === "textarea" ||
    tagName === "title";
}

function shouldDecodeEntitiesInRaw(tagName) {
  return tagName === "textarea" || tagName === "title";
}

function findRawCloseIndex(lowerHTML, offset, tagName) {
  if (tagName === "script") {
    return findScriptRawCloseIndex(lowerHTML, offset);
  }
  const needle = `</${tagName}`;
  let i = lowerHTML.indexOf(needle, offset);
  while (i >= 0) {
    const after = lowerHTML[i + needle.length] || "";
    if (after === ">" || /\s/.test(after) || after === "/") {
      const closeEnd = lowerHTML.indexOf(">", i + needle.length);
      if (closeEnd >= 0) {
        return i;
      }
      return -1;
    }
    i = lowerHTML.indexOf(needle, i + 1);
  }
  return -1;
}

function findScriptRawCloseIndex(lowerHTML, offset) {
  let i = offset;
  let scriptDataEscaped = false;
  let scriptDataDoubleEscaped = false;

  while (i < lowerHTML.length) {
    if (!scriptDataEscaped && lowerHTML.startsWith("<!--", i)) {
      scriptDataEscaped = true;
      i += 4;
      continue;
    }

    if (scriptDataEscaped && !scriptDataDoubleEscaped && lowerHTML.startsWith("<script", i) && isTagBoundary(lowerHTML, i + 7)) {
      const end = findTagCloseIndex(lowerHTML, i + 7);
      if (end < 0) {
        return -1;
      }
      scriptDataDoubleEscaped = true;
      i = end + 1;
      continue;
    }

    if (scriptDataDoubleEscaped && lowerHTML.startsWith("</script", i) && isTagBoundary(lowerHTML, i + 8)) {
      const end = findTagCloseIndex(lowerHTML, i + 8);
      if (end < 0) {
        return -1;
      }
      scriptDataDoubleEscaped = false;
      i = end + 1;
      continue;
    }

    if (scriptDataDoubleEscaped && lowerHTML.startsWith("-->", i)) {
      scriptDataDoubleEscaped = false;
      i += 3;
      continue;
    }

    if (!scriptDataDoubleEscaped && lowerHTML.startsWith("</script", i) && isTagBoundary(lowerHTML, i + 8)) {
      const lastScriptStart = lowerHTML.lastIndexOf("<script", i);
      const lastTagClose = lowerHTML.lastIndexOf(">", i);
      const lastScriptAfter = lastScriptStart >= 0 ? (lowerHTML[lastScriptStart + 7] || "") : "";
      if (scriptDataEscaped && lastScriptStart > lastTagClose && lastScriptAfter === "/") {
        const skippedEnd = findTagCloseIndex(lowerHTML, i + 8);
        if (skippedEnd < 0) {
          return -1;
        }
        i = skippedEnd + 1;
        continue;
      }
      const end = findTagCloseIndex(lowerHTML, i + 8);
      if (end >= 0) {
        return i;
      }
      return -1;
    }

    i += 1;
  }

  return -1;
}

function isTagBoundary(text, index) {
  const ch = text[index] || "";
  return ch === ">" || ch === "/" || /\s/.test(ch);
}

function findTagCloseIndex(text, fromIndex) {
  let quote = "";
  for (let i = Math.max(0, fromIndex); i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ">") {
      return i;
    }
  }
  return -1;
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

  const kw = readKeywordToken();
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

  function readKeywordToken() {
    const save = i;
    const rest = text.slice(i).toLowerCase();
    if (rest.startsWith("public")) {
      i += 6;
      return "public";
    }
    if (rest.startsWith("system")) {
      i += 6;
      return "system";
    }
    return readKeyword() || (() => {
      i = save;
      return "";
    })();
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

function findDoctypeCloseIndex(text, start) {
  let quote = "";
  let bracketDepth = 0;
  for (let i = Math.max(0, start); i < text.length; i += 1) {
    const ch = text[i];
    if (!quote && text.startsWith("<!--", i)) {
      const commentEnd = text.indexOf("-->", i + 4);
      if (commentEnd < 0) {
        return -1;
      }
      i = commentEnd + 2;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth += 1;
      continue;
    }
    if (ch === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }
    if (ch === ">" && bracketDepth === 0) {
      return i;
    }
  }
  return -1;
}
