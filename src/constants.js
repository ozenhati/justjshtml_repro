export const VOID_ELEMENTS = new Set([
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

export const RAWTEXT_ELEMENTS = new Set(["script", "style", "textarea", "title", "plaintext"]);

export const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul"
]);

export const HTML_CONTEXT = Object.freeze({
  HTML: "html",
  JS_STRING: "js_string",
  HTML_ATTR_VALUE: "html_attr_value",
  URL: "url"
});
