import { decodeHTML } from "./encoding.js";
import { tokenizeHTML, TokenKind } from "./tokenizer.js";

export function* stream(input, options = {}) {
  const { text } = decodeHTML(input, options.encoding ?? null);
  const { tokens } = tokenizeHTML(text, { collectErrors: false });

  let textBuffer = "";
  for (const token of tokens) {
    if (token.kind === TokenKind.TEXT) {
      textBuffer += token.data;
      continue;
    }

    if (textBuffer) {
      yield ["text", textBuffer];
      textBuffer = "";
    }

    if (token.kind === TokenKind.START_TAG) {
      yield ["start", [token.name, { ...(token.attrs || {}) }]];
      if (token.selfClosing) {
        yield ["end", token.name];
      }
      continue;
    }

    if (token.kind === TokenKind.END_TAG) {
      yield ["end", token.name];
      continue;
    }

    if (token.kind === TokenKind.COMMENT) {
      yield ["comment", token.data || ""];
      continue;
    }

    if (token.kind === TokenKind.DOCTYPE) {
      yield ["doctype", [token.name || "html", token.publicId || null, token.systemId || null]];
    }
  }

  if (textBuffer) {
    yield ["text", textBuffer];
  }
}
