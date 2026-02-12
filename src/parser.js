import { HTML_CONTEXT } from "./constants.js";
import { decodeHTML } from "./encoding.js";
import { StrictModeError, sortErrors } from "./errors.js";
import { toHTML, escapeJSString, escapeURLValue } from "./serialize.js";
import { tokenizeHTML } from "./tokenizer.js";
import { buildTree } from "./treebuilder.js";

export class FragmentContext {
  constructor(tagName, namespace = null) {
    this.tagName = String(tagName);
    this.namespace = namespace;
  }
}

export class JustHTML {
  constructor(input, options = {}) {
    this.options = options;
    this.fragmentContext = normalizeFragmentContext(options.fragmentContext);

    const { text, encoding } = decodeHTML(input, options.encoding ?? null);
    this.encoding = encoding;

    const collectErrors = Boolean(options.collectErrors || options.strict);
    const tokenized = tokenizeHTML(text, { collectErrors });
    const built = buildTree(tokenized.tokens, text, {
      fragment: Boolean(options.fragment || this.fragmentContext),
      fragmentContext: this.fragmentContext,
      collectErrors,
      trackNodeLocations: Boolean(options.trackNodeLocations)
    });

    this.root = built.root;
    this.errors = sortErrors([...(tokenized.errors || []), ...(built.errors || [])]);

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
    return toHTML(this.root, options);
  }

  toText(options = {}) {
    return this.root.toText(options);
  }

  static escapeJSString(value, { quote = '"' } = {}) {
    return escapeJSString(value, quote);
  }

  static escapeAttrValue(value, { quote = '"' } = {}) {
    const escaped = String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    if (quote === '"') {
      return escaped.replaceAll('"', "&quot;");
    }
    if (quote === "'") {
      return escaped.replaceAll("'", "&#39;");
    }
    throw new Error("quote must be \" or '");
  }

  static escapeURLValue(value) {
    return escapeURLValue(value);
  }

  static escapeURLInJSString(value, { quote = '"' } = {}) {
    return escapeJSString(escapeURLValue(value), quote);
  }

  static escapeHTMLTextInJSString(value, { quote = '"' } = {}) {
    const escaped = String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return escapeJSString(escaped, quote);
  }
}

export function parse(input, options = {}) {
  return new JustHTML(input, options);
}

export function parseFragment(input, contextOrOptions = {}) {
  if (contextOrOptions instanceof FragmentContext) {
    return new JustHTML(input, { fragmentContext: contextOrOptions, fragment: true });
  }
  if (contextOrOptions && typeof contextOrOptions === "object" && "tagName" in contextOrOptions) {
    return new JustHTML(input, { fragmentContext: contextOrOptions, fragment: true });
  }
  return new JustHTML(input, { ...contextOrOptions, fragment: true });
}

export { HTML_CONTEXT as HTMLContext };

function normalizeFragmentContext(fragmentContext) {
  if (!fragmentContext) {
    return null;
  }
  if (fragmentContext instanceof FragmentContext) {
    return fragmentContext;
  }
  return new FragmentContext(fragmentContext.tagName, fragmentContext.namespace ?? null);
}
