import { VOID_ELEMENTS } from "./constants.js";
import { ParseError } from "./errors.js";
import { Comment, Doctype, Document, DocumentFragment, Element, Template, Text } from "./node.js";
import { TokenKind } from "./tokenizer.js";

const HEAD_TAGS = new Set(["base", "link", "meta", "noscript", "script", "style", "template", "title"]);
const FORMATTING_TAGS = new Set(["a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u"]);
const FOREIGN_BREAKOUT_TAGS = new Set([
  "b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3",
  "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s",
  "small", "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var"
]);
const A_REPARENT_BLOCKS = new Set(["div", "address"]);
const CLOSE_P_ON_START = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "center",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "hgroup",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "listing",
  "main",
  "menu",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul"
]);

export function buildTree(tokens, html, options = {}) {
  const {
    fragment = false,
    collectErrors = false,
    fragmentContext = null,
    trackNodeLocations = false
  } = options;

  const root = fragment ? new DocumentFragment() : new Document();
  const errors = [];
  const fragmentNamespace = fragmentContext?.namespace || "html";
  const fragmentContextTag = fragmentContext?.tagName ? String(fragmentContext.tagName).toLowerCase() : null;

  let documentElement = null;
  let headElement = null;
  let bodyElement = null;
  let seenDoctype = false;
  let afterBody = false;
  let framesetOk = true;
  let fragmentRootNamespaceOverride = null;

  const stack = [root];

  for (const token of tokens) {
    switch (token.kind) {
      case TokenKind.DOCTYPE: {
        if (fragment || seenDoctype || documentElement) {
          break;
        }
        seenDoctype = true;
        const dt = new Doctype(token.name, token.publicId, token.systemId);
        maybeSetLocation(dt, token.pos, html, trackNodeLocations);
        root.appendChild(dt);
        break;
      }
      case TokenKind.COMMENT: {
        if (!fragment && !documentElement) {
          const comment = new Comment(token.data);
          maybeSetLocation(comment, token.pos, html, trackNodeLocations);
          root.appendChild(comment);
          break;
        }
        if (!fragment && afterBody) {
          const comment = new Comment(token.data);
          maybeSetLocation(comment, token.pos, html, trackNodeLocations);
          root.appendChild(comment);
          break;
        }
        if (!fragment) {
          ensureScaffold(root, () => ({ documentElement, headElement, bodyElement }), (next) => {
            documentElement = next.documentElement;
            headElement = next.headElement;
            bodyElement = next.bodyElement;
          });
          ensureDocumentOnStack(stack, documentElement);
        }
        const comment = new Comment(token.data);
        maybeSetLocation(comment, token.pos, html, trackNodeLocations);
        if (!fragment && (token.data || "").startsWith("?")) {
          root.insertBefore(comment, root.children[0] || null);
          break;
        }
        if (!fragment && stack[stack.length - 1]?.name === "html" && headElement && bodyElement) {
          const headEmpty = headElement.children.length === 0;
          const bodyEmpty = bodyElement.children.length === 0;
          if (headEmpty && bodyEmpty) {
            stack[stack.length - 1].insertBefore(comment, headElement);
            break;
          }
        }
        currentNode(stack, root, bodyElement).appendChild(comment);
        break;
      }
      case TokenKind.TEXT: {
        const textForFrameset = (token.data || "").replaceAll("\u0000", "");
        if (!fragment && textForFrameset && /\S/.test(textForFrameset)) {
          framesetOk = false;
        }
        if (!fragment && textForFrameset && /\S/.test(textForFrameset)) {
          afterBody = false;
        }
        if (!fragment && framesetOk && !/\S/.test(textForFrameset) && !bodyElement) {
          break;
        }
        if (!fragment) {
          ensureScaffold(root, () => ({ documentElement, headElement, bodyElement }), (next) => {
            documentElement = next.documentElement;
            headElement = next.headElement;
            bodyElement = next.bodyElement;
          });
          ensureDocumentOnStack(stack, documentElement);
        }
        if (!token.data) {
          break;
        }
        let textData = token.data;
        const parentForText = currentNode(stack, root, bodyElement);
        if (parentForText?.namespace === "html") {
          if (parentForText.name === "script" || parentForText.name === "style" || parentForText.name === "plaintext") {
            textData = textData.replaceAll("\u0000", "\ufffd");
          } else {
            textData = textData.replaceAll("\u0000", "");
          }
        } else {
          const isSvgHtmlIntegrationPoint = parentForText?.namespace === "svg" &&
            (parentForText?.name === "foreignobject" || parentForText?.name === "desc" || parentForText?.name === "title");
          const isMathTextIntegrationPoint = parentForText?.namespace === "math" &&
            (parentForText?.name === "mi" || parentForText?.name === "mo" || parentForText?.name === "mn" || parentForText?.name === "ms" || parentForText?.name === "mtext");
          if (isSvgHtmlIntegrationPoint || isMathTextIntegrationPoint) {
            textData = textData.replaceAll("\u0000", "");
          } else {
            textData = textData.replaceAll("\u0000", "\ufffd");
          }
        }
        if (parentForText?.name === "pre" && parentForText.children.length === 0 && textData.startsWith("\n")) {
          textData = textData.slice(1);
        }
        if (!textData) {
          break;
        }
        if (!fragment && parentForText?.namespace === "html" && parentForText?.name === "colgroup") {
          const leadingWhitespace = textData.match(/^\s*/)?.[0] || "";
          const remainder = textData.slice(leadingWhitespace.length);
          if (leadingWhitespace) {
            const wsNode = new Text(leadingWhitespace);
            maybeSetLocation(wsNode, token.pos, html, trackNodeLocations);
            parentForText.appendChild(wsNode);
          }
          if (remainder) {
            const fostered = new Text(remainder);
            maybeSetLocation(fostered, token.pos, html, trackNodeLocations);
            fosterParentInsert(fostered, stack, bodyElement);
          }
          break;
        }
        const textNode = new Text(textData);
        maybeSetLocation(textNode, token.pos, html, trackNodeLocations);
        if (!fragment && shouldFosterParentText(stack)) {
          fosterParentInsert(textNode, stack, bodyElement);
        } else {
          currentNode(stack, root, bodyElement).appendChild(textNode);
        }
        break;
      }
      case TokenKind.START_TAG: {
        afterBody = false;
        const name = token.name;
        if (fragment) {
          if (fragmentNamespace !== "html" && (name === "html" || name === "head" || name === "body" || name === "frameset")) {
            break;
          }
          let parent = currentNode(stack, root);
          const defaultNamespace = parent === root
            ? (fragmentRootNamespaceOverride || fragmentDefaultNamespace(fragmentNamespace, fragmentContextTag))
            : (parent?.namespace || "html");
          const ns = inferNamespace(name, parent, defaultNamespace, token.attrs || {});
          if (ns === "html" && parent?.namespace && parent.namespace !== "html") {
            while (stack.length > 1 && stack[stack.length - 1]?.namespace !== "html") {
              stack.pop();
            }
            parent = currentNode(stack, root);
            fragmentRootNamespaceOverride = "html";
          }
          const element = createElement(name, token.attrs, ns);
          maybeSetLocation(element, token.pos, html, trackNodeLocations);
          parent.appendChild(element);
          const selfClosingHonored = token.selfClosing && (ns !== "html" || VOID_ELEMENTS.has(name));
          if (!selfClosingHonored && !VOID_ELEMENTS.has(name)) {
            stack.push(element);
          }
          break;
        }

        ensureScaffold(root, () => ({ documentElement, headElement, bodyElement }), (next) => {
          documentElement = next.documentElement;
          headElement = next.headElement;
          bodyElement = next.bodyElement;
        });
        ensureDocumentOnStack(stack, documentElement);

        const insertionPoint = currentNode(stack, root, bodyElement);
        const inHtmlContext = !insertionPoint?.namespace || insertionPoint.namespace === "html";
        if (name === "frameset" && inHtmlContext) {
          if (!framesetOk) {
            break;
          }
          if (bodyElement && bodyElement.parent === documentElement) {
            documentElement.removeChild(bodyElement);
            bodyElement = null;
          }
          const frameset = createElement("frameset", token.attrs, "html");
          maybeSetLocation(frameset, token.pos, html, trackNodeLocations);
          documentElement.appendChild(frameset);
          stack.length = 2;
          stack.push(frameset);
          break;
        }

        if (name === "input" && String(token.attrs?.type || "").toLowerCase() !== "hidden") {
          framesetOk = false;
        }

        if (name === "html") {
          if (!documentElement) {
            documentElement = createElement("html", token.attrs, "html");
            maybeSetLocation(documentElement, token.pos, html, trackNodeLocations);
            root.appendChild(documentElement);
            stack.length = 1;
            stack.push(documentElement);
          } else {
            Object.assign(documentElement.attrs, token.attrs || {});
          }
          break;
        }

        if (name === "head") {
          if (!headElement) {
            headElement = createElement("head", token.attrs, "html");
            maybeSetLocation(headElement, token.pos, html, trackNodeLocations);
            documentElement.appendChild(headElement);
          }
          ensureDocumentOnStack(stack, documentElement);
          stack.length = 2;
          stack.push(headElement);
          break;
        }

        if (name === "body") {
          if (!bodyElement) {
            bodyElement = createElement("body", token.attrs, "html");
            maybeSetLocation(bodyElement, token.pos, html, trackNodeLocations);
            documentElement.appendChild(bodyElement);
          } else {
            for (const [key, value] of Object.entries(token.attrs || {})) {
              if (!(key in bodyElement.attrs)) {
                bodyElement.attrs[key] = value;
              }
            }
          }
          ensureDocumentOnStack(stack, documentElement);
          stack.length = 2;
          stack.push(bodyElement);
          break;
        }

        if (!fragment) {
          applySelectStartTagHeuristics(name, stack);
        }

        let parent = chooseParent(stack, bodyElement, headElement, name);
        alignStackForParent(stack, parent, documentElement, headElement, bodyElement);

        if (!fragment && shouldFosterParentElement(stack, name)) {
          const fosterParent = findFosterParent(stack, bodyElement);
          const ns = inferNamespace(name, fosterParent);
          const fostered = createElement(name, token.attrs, ns);
          maybeSetLocation(fostered, token.pos, html, trackNodeLocations);
          fosterParentInsert(fostered, stack, bodyElement);
          const selfClosingHonored = token.selfClosing && (ns !== "html" || VOID_ELEMENTS.has(name));
          if (!selfClosingHonored && !VOID_ELEMENTS.has(name)) {
            stack.push(fostered);
          }
          break;
        }

        if (!fragment && (name === "td" || name === "th")) {
          ensureTableCellContext(stack, bodyElement);
          parent = currentNode(stack, root, bodyElement);
        }
        if (!fragment && name === "tr") {
          ensureTableRowContext(stack, bodyElement);
          parent = currentNode(stack, root, bodyElement);
        }

        if (!fragment && name === "a") {
          const openA = findOpenElement(stack, "a");
          if (openA >= 0) {
            stack.length = openA;
            parent = currentNode(stack, root, bodyElement);
          }
        }

        let reopenInsideNewElement = [];
        if (!fragment && A_REPARENT_BLOCKS.has(name)) {
          const current = currentNode(stack, root, bodyElement);
          if (current && current.name === "a") {
            reopenInsideNewElement.push({ name: "a", attrs: { ...(current.attrs || {}) } });
            stack.length = Math.max(1, stack.length - 1);
            parent = currentNode(stack, root, bodyElement);
          }
        }

        if (!fragment && CLOSE_P_ON_START.has(name)) {
          const pIndex = findOpenElement(stack, "p");
          if (pIndex >= 0) {
            if (name === "p") {
              const above = stack.slice(pIndex + 1);
              const formattingAbove = above.filter((node) => FORMATTING_TAGS.has(node.name));
              reopenInsideNewElement = (formattingAbove.length > 1 ? formattingAbove.slice(0, -1) : formattingAbove)
                .map((node) => ({ name: node.name, attrs: { ...(node.attrs || {}) } }));
            }
            stack.length = pIndex;
            parent = currentNode(stack, root, bodyElement);
          }
        }

        const ns = inferNamespace(name, parent, "html", token.attrs || {});
        if (ns === "html" && parent?.namespace && parent.namespace !== "html") {
          while (stack.length > 1 && stack[stack.length - 1]?.namespace !== "html") {
            stack.pop();
          }
          parent = currentNode(stack, root, bodyElement);
        }
        const element = createElement(name, token.attrs, ns);
        maybeSetLocation(element, token.pos, html, trackNodeLocations);
        parent.appendChild(element);
        const selfClosingHonored = token.selfClosing && (ns !== "html" || VOID_ELEMENTS.has(name));
        if (!selfClosingHonored && !VOID_ELEMENTS.has(name)) {
          stack.push(element);
          if (reopenInsideNewElement.length) {
            let current = element;
            for (const info of reopenInsideNewElement) {
              const reopened = createElement(info.name, info.attrs);
              current.appendChild(reopened);
              stack.push(reopened);
              current = reopened;
            }
          }
        }
        break;
      }
      case TokenKind.END_TAG: {
        if (fragment) {
          const topNamespace = stack[stack.length - 1]?.namespace;
          if ((token.name === "p" || token.name === "br") && topNamespace !== "html") {
            let poppedForeign = false;
            while (stack.length > 1 && stack[stack.length - 1]?.namespace !== "html") {
              poppedForeign = true;
              stack.pop();
            }
            const synthetic = createElement(token.name, {}, "html");
            root.appendChild(synthetic);
            if (poppedForeign) {
              fragmentRootNamespaceOverride = "html";
            }
            break;
          }
        }
        const foundIndex = findOpenElement(stack, token.name);
        if (foundIndex < 0) {
          if (token.name === "br") {
            const parent = currentNode(stack, root, bodyElement);
            parent.appendChild(createElement("br", {}, inferNamespace("br", parent, "html", {})));
            break;
          }
          pushTreeError(errors, collectErrors, "unexpected-end-tag", `Unexpected </${token.name}> end tag`, token.pos, html);
          break;
        }
        if (hasForeignContentAbove(stack, foundIndex)) {
          break;
        }
        if (token.name === "b" && tryHoistTrailingAsideFromFormatting(stack, foundIndex)) {
          break;
        }
        if (token.name === "p") {
          const pNode = stack[foundIndex];
          const parent = pNode.parent;
          const above = stack.slice(foundIndex + 1).filter((node) => FORMATTING_TAGS.has(node.name));
          stack.length = foundIndex;
          if (parent && above.length) {
            let prev = pNode;
            let currentParent = parent;
            for (const source of above) {
              const clone = createElement(source.name, { ...(source.attrs || {}) });
              insertAfter(currentParent, clone, prev);
              stack.push(clone);
              currentParent = clone;
              prev = clone;
            }
          }
          break;
        }
        if (FORMATTING_TAGS.has(token.name)) {
          if (tryFormattingSplitRecovery(stack, foundIndex)) {
            break;
          }
          if (tryMisnestedFormattingRecovery(stack, foundIndex)) {
            break;
          }
        }
        stack.length = foundIndex;
        if (token.name === "body" || token.name === "html") {
          afterBody = true;
        }
        break;
      }
      default:
        break;
    }
  }

  if (collectErrors) {
    for (let i = stack.length - 1; i >= 1; i -= 1) {
      const node = stack[i];
      if (node.name.startsWith("#") || node.name === "!doctype") {
        continue;
      }
      if (node.name === "html" || node.name === "head" || node.name === "body") {
        continue;
      }
      pushTreeError(errors, true, "expected-closing-tag-but-got-eof", `Expected closing tag for <${node.name}> before EOF`, null, html);
    }
  }

  if (!fragment) {
    ensureScaffold(root, () => ({ documentElement, headElement, bodyElement }), (next) => {
      documentElement = next.documentElement;
      headElement = next.headElement;
      bodyElement = next.bodyElement;
    });
  }

  return { root, errors };
}

function createElement(name, attrs, namespace = "html") {
  if (name === "template") {
    return new Template(name, attrs || {}, namespace);
  }
  return new Element(name, attrs || {}, namespace);
}

function ensureScaffold(root, getState, setState) {
  const state = getState();
  let { documentElement, headElement, bodyElement } = state;

  if (!documentElement) {
    documentElement = new Element("html", {}, "html");
    root.appendChild(documentElement);
  }
  if (!headElement) {
    headElement = new Element("head", {}, "html");
    documentElement.appendChild(headElement);
  }
  const hasFrameset = documentElement.children.some((child) => child?.name === "frameset");
  if (!bodyElement && !hasFrameset) {
    bodyElement = new Element("body", {}, "html");
    documentElement.appendChild(bodyElement);
  }

  setState({ documentElement, headElement, bodyElement });
}

function chooseParent(stack, bodyElement, headElement, tagName) {
  const current = stack[stack.length - 1] || currentNode(stack, null, bodyElement);
  if (current.name === "html") {
    if (HEAD_TAGS.has(tagName)) {
      return headElement || current;
    }
    return bodyElement || current;
  }
  if (current.name === "head" && !HEAD_TAGS.has(tagName)) {
    stack.pop();
    return bodyElement || current;
  }
  return current;
}

function currentNode(stack, fallbackRoot, bodyElement = null) {
  if (stack.length > 1) {
    const top = stack[stack.length - 1];
    if (top && top.name === "html" && bodyElement) {
      return bodyElement;
    }
    return stack[stack.length - 1];
  }
  if (bodyElement) {
    return bodyElement;
  }
  return fallbackRoot || stack[0];
}

function findOpenElement(stack, name) {
  for (let i = stack.length - 1; i >= 1; i -= 1) {
    if (stack[i] && stack[i].name === name) {
      return i;
    }
  }
  return -1;
}

function ensureDocumentOnStack(stack, documentElement) {
  if (!documentElement) {
    return;
  }
  if (stack.length < 2) {
    stack.push(documentElement);
    return;
  }
  stack[1] = documentElement;
}

function tryMisnestedFormattingRecovery(stack, formattingIndex) {
  if (formattingIndex < 1 || formattingIndex >= stack.length - 1) {
    return false;
  }

  const formatting = stack[formattingIndex];
  const above = stack.slice(formattingIndex + 1);
  if (!above.length || above.every((node) => FORMATTING_TAGS.has(node.name))) {
    return false;
  }

  const pivot = above.find((node) => !FORMATTING_TAGS.has(node.name));
  if (!pivot || !pivot.parent || !formatting.parent) {
    return false;
  }

  const pivotIdx = above.indexOf(pivot);
  let formattingPrefix = above.slice(0, pivotIdx).filter((node) => FORMATTING_TAGS.has(node.name));
  if (formattingPrefix.length > 1 && formattingPrefix[0].name !== formattingPrefix[1].name) {
    formattingPrefix = formattingPrefix.slice(1);
  }
  const trailingOpen = above.slice(pivotIdx + 1).filter((node) => !FORMATTING_TAGS.has(node.name));

  const originalPivotParent = pivot.parent;
  originalPivotParent.removeChild(pivot);

  let insertionPoint = formatting;
  let reopenParent = formatting.parent;
  const reopenedPrefix = [];
  for (const source of formattingPrefix) {
    const clone = createElement(source.name, { ...(source.attrs || {}) });
    insertAfter(reopenParent, clone, insertionPoint);
    reopenedPrefix.push(clone);
    reopenParent = clone;
    insertionPoint = clone;
  }
  if (reopenedPrefix.length) {
    reopenParent.appendChild(pivot);
  } else {
    insertAfter(reopenParent, pivot, formatting);
  }

  const formattingClone = createElement(formatting.name, { ...(formatting.attrs || {}) });
  const childrenToWrap = [];
  for (const child of pivot.children) {
    if (isInlineLikeNode(child)) {
      childrenToWrap.push(child);
      continue;
    }
    break;
  }
  for (const child of childrenToWrap) {
    pivot.removeChild(child);
    formattingClone.appendChild(child);
  }
  if (childrenToWrap.length || formatting.name === "a") {
    pivot.insertBefore(formattingClone, pivot.children[0] || null);
  }
  if (formatting.name === "a") {
    sprinkleFormattingOnBlockDescendants(pivot, formatting.name, formatting.attrs || {});
  }

  stack.length = formattingIndex;
  for (const clone of reopenedPrefix) {
    stack.push(clone);
  }
  stack.push(pivot);
  for (const node of trailingOpen) {
    stack.push(node);
  }
  return true;
}

function tryFormattingSplitRecovery(stack, formattingIndex) {
  if (formattingIndex < 1 || formattingIndex >= stack.length - 1) {
    return false;
  }
  const formatting = stack[formattingIndex];
  const above = stack.slice(formattingIndex + 1);
  if (!above.length || !above.every((node) => FORMATTING_TAGS.has(node.name))) {
    return false;
  }
  if (!formatting.parent) {
    return false;
  }

  const parent = formatting.parent;
  let reopenParent = null;
  const reopened = [];

  for (let i = 0; i < above.length; i += 1) {
    const source = above[i];
    const clone = createElement(source.name, { ...(source.attrs || {}) });
    if (i === 0) {
      insertAfter(parent, clone, formatting);
    } else {
      reopenParent.appendChild(clone);
    }
    reopened.push(clone);
    reopenParent = clone;
  }

  stack.length = formattingIndex;
  for (const node of reopened) {
    stack.push(node);
  }
  return true;
}

function alignStackForParent(stack, parent, documentElement, headElement, bodyElement) {
  if (!parent) {
    return;
  }
  if (parent === bodyElement) {
    ensureDocumentOnStack(stack, documentElement);
    stack.length = 2;
    stack.push(bodyElement);
    return;
  }
  if (parent === headElement) {
    ensureDocumentOnStack(stack, documentElement);
    stack.length = 2;
    stack.push(headElement);
    return;
  }
}

function insertAfter(parent, node, referenceNode) {
  const idx = parent.children.indexOf(referenceNode);
  if (idx < 0 || idx + 1 >= parent.children.length) {
    parent.appendChild(node);
    return;
  }
  parent.insertBefore(node, parent.children[idx + 1]);
}

function shouldFosterParentText(stack) {
  const top = stack[stack.length - 1];
  if (!top) {
    return false;
  }
  return top.name === "table" || top.name === "tbody" || top.name === "thead" || top.name === "tfoot" || top.name === "tr";
}

function shouldFosterParentElement(stack, tagName) {
  const top = stack[stack.length - 1];
  if (!top || top.name !== "table") {
    return false;
  }
  if (
    tagName === "caption" ||
    tagName === "colgroup" ||
    tagName === "tbody" ||
    tagName === "tfoot" ||
    tagName === "thead" ||
    tagName === "tr" ||
    tagName === "td" ||
    tagName === "th"
  ) {
    return false;
  }
  return true;
}

function fosterParentInsert(node, stack, bodyElement) {
  const tableIndex = findNearestIndex(stack, "table");
  if (tableIndex < 0) {
    if (bodyElement) {
      bodyElement.appendChild(node);
    }
    return;
  }
  const table = stack[tableIndex];
  const parent = table.parent || bodyElement;
  if (!parent) {
    return;
  }

  if (node.name === "#text") {
    const tablePos = parent.children.indexOf(table);
    const prevSibling = tablePos > 0 ? parent.children[tablePos - 1] : null;
    if (prevSibling && prevSibling.name === "a") {
      const aClone = createElement("a", { ...(prevSibling.attrs || {}) });
      aClone.appendChild(node);
      parent.insertBefore(aClone, table);
      return;
    }
  }

  parent.insertBefore(node, table);
}

function ensureTableCellContext(stack, bodyElement) {
  const trIndex = findNearestIndex(stack, "tr");
  if (trIndex >= 0) {
    stack.length = trIndex + 1;
    return;
  }
  const tableIndex = findNearestIndex(stack, "table");
  if (tableIndex < 0) {
    return;
  }
  const table = stack[tableIndex];
  let tbody = null;
  for (let i = table.children.length - 1; i >= 0; i -= 1) {
    const child = table.children[i];
    if (child.name === "tbody") {
      tbody = child;
      break;
    }
  }
  if (!tbody) {
    tbody = new Element("tbody", {}, "html");
    table.appendChild(tbody);
  }
  const tr = new Element("tr", {}, "html");
  tbody.appendChild(tr);
  stack.length = tableIndex + 1;
  stack.push(tbody);
  stack.push(tr);
  if (bodyElement && table.parent == null) {
    bodyElement.appendChild(table);
  }
}

function ensureTableRowContext(stack, bodyElement) {
  const tableIndex = findNearestIndex(stack, "table");
  if (tableIndex < 0) {
    return;
  }
  const top = stack[stack.length - 1];
  if (top && (top.name === "tbody" || top.name === "thead" || top.name === "tfoot")) {
    return;
  }
  const table = stack[tableIndex];
  let tbody = null;
  for (let i = table.children.length - 1; i >= 0; i -= 1) {
    const child = table.children[i];
    if (child.name === "tbody" || child.name === "thead" || child.name === "tfoot") {
      tbody = child;
      break;
    }
  }
  if (!tbody) {
    tbody = new Element("tbody", {}, "html");
    table.appendChild(tbody);
  }
  stack.length = tableIndex + 1;
  stack.push(tbody);
  if (bodyElement && table.parent == null) {
    bodyElement.appendChild(table);
  }
}

function applySelectStartTagHeuristics(tagName, stack) {
  const selectIndex = findNearestIndex(stack, "select");
  if (selectIndex < 0) {
    return;
  }

  const optionIndex = findNearestIndex(stack, "option");
  const optgroupIndex = findNearestIndex(stack, "optgroup");

  if (tagName === "option") {
    if (optionIndex > selectIndex) {
      stack.length = optionIndex;
    }
    return;
  }

  if (tagName === "optgroup") {
    if (optionIndex > selectIndex) {
      stack.length = optionIndex;
    }
    if (optgroupIndex > selectIndex) {
      stack.length = Math.min(stack.length, optgroupIndex);
    }
    return;
  }

  if (tagName === "hr") {
    if (optionIndex > selectIndex) {
      stack.length = optionIndex;
    }
    if (optgroupIndex > selectIndex) {
      stack.length = Math.min(stack.length, optgroupIndex);
    }
    return;
  }

  if (tagName === "input" || tagName === "keygen" || tagName === "textarea") {
    stack.length = selectIndex;
    return;
  }

  if (tagName === "select") {
    stack.length = selectIndex;
  }
}

function findNearestIndex(stack, name) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i] && stack[i].name === name) {
      return i;
    }
  }
  return -1;
}

function inferNamespace(tagName, parent, defaultNamespace = "html", attrs = {}) {
  if (tagName === "svg") {
    return "svg";
  }
  if (tagName === "math") {
    return "math";
  }
  if (tagName === "mglyph" || tagName === "malignmark") {
    return "math";
  }
  if (defaultNamespace !== "html") {
    if (FOREIGN_BREAKOUT_TAGS.has(tagName)) {
      return "html";
    }
    if (tagName === "font" && (attrs.color != null || attrs.face != null || attrs.size != null)) {
      return "html";
    }
  }
  if (parent && parent.namespace && parent.namespace !== "html") {
    if (FOREIGN_BREAKOUT_TAGS.has(tagName)) {
      return "html";
    }
    if (tagName === "font") {
      if (attrs.color != null || attrs.face != null || attrs.size != null) {
        return "html";
      }
    }
    if (parent.name === "foreignobject") {
      return "html";
    }
    return parent.namespace;
  }
  return defaultNamespace || "html";
}

function fragmentDefaultNamespace(namespace, contextTag) {
  if (namespace === "svg") {
    if (contextTag === "foreignobject" || contextTag === "desc" || contextTag === "title") {
      return "html";
    }
    return "svg";
  }
  if (namespace === "math") {
    if (contextTag === "mi" || contextTag === "mo" || contextTag === "mn" || contextTag === "ms" || contextTag === "mtext") {
      return "html";
    }
    return "math";
  }
  return "html";
}

function hasForeignContentAbove(stack, index) {
  for (let i = stack.length - 1; i > index; i -= 1) {
    const ns = stack[i]?.namespace;
    if (ns && ns !== "html") {
      return true;
    }
  }
  return false;
}

function findFosterParent(stack, bodyElement) {
  const tableIndex = findNearestIndex(stack, "table");
  if (tableIndex > 0) {
    const table = stack[tableIndex];
    return table.parent || bodyElement || stack[0];
  }
  return bodyElement || stack[0];
}

function isInlineLikeNode(node) {
  if (!node || typeof node.name !== "string") {
    return false;
  }
  if (node.name.startsWith("#")) {
    return true;
  }
  return FORMATTING_TAGS.has(node.name);
}

function sprinkleFormattingOnBlockDescendants(rootNode, formattingName, formattingAttrs) {
  for (const child of rootNode.children) {
    if (!child || child.name.startsWith("#") || FORMATTING_TAGS.has(child.name)) {
      continue;
    }
    if (child.namespace && child.namespace !== "html") {
      continue;
    }
    if (!child.children.length) {
      continue;
    }
    if (
      child.children.length === 1 &&
      !isInlineLikeNode(child.children[0]) &&
      child.children[0].children &&
      child.children[0].children.length === 0
    ) {
      continue;
    }
    const clone = createElement(formattingName, { ...formattingAttrs }, "html");
    child.insertBefore(clone, child.children[0] || null);
    const leading = [];
    for (const grandChild of child.children) {
      if (grandChild === clone) {
        continue;
      }
      if (isInlineLikeNode(grandChild)) {
        leading.push(grandChild);
        continue;
      }
      break;
    }
    for (const item of leading) {
      child.removeChild(item);
      clone.appendChild(item);
    }
    if (!clone.children.length && child.children.length === 1 && !isInlineLikeNode(child.children[0])) {
      const only = child.children[0];
      child.removeChild(only);
      clone.appendChild(only);
    }
    const rest = child.children.filter((node) => node !== clone);
    if (
      !clone.children.length &&
      rest.length === 1 &&
      !isInlineLikeNode(rest[0]) &&
      rest[0].children &&
      rest[0].children.length === 1 &&
      rest[0].children[0].children &&
      rest[0].children[0].children.length === 0
    ) {
      child.removeChild(rest[0]);
      clone.appendChild(rest[0]);
    }
    sprinkleFormattingOnBlockDescendants(child, formattingName, formattingAttrs);
  }
}

function tryHoistTrailingAsideFromFormatting(stack, formattingIndex) {
  if (formattingIndex < 1 || formattingIndex >= stack.length - 1) {
    return false;
  }
  const formatting = stack[formattingIndex];
  const tail = stack[stack.length - 1];
  if (!tail || tail.name !== "aside" || !tail.parent || !formatting.parent) {
    return false;
  }
  tail.parent.removeChild(tail);
  insertAfter(formatting.parent, tail, formatting);
  const reopened = createElement("b", { ...(formatting.attrs || {}) }, "html");
  tail.insertBefore(reopened, tail.children[0] || null);
  stack.length = formattingIndex;
  return true;
}

function maybeSetLocation(node, offset, html, enabled) {
  if (!enabled || offset == null) {
    return;
  }
  const { line, column } = toLineCol(html, offset);
  node.originOffset = offset;
  node.originLine = line;
  node.originCol = column;
}

function pushTreeError(errors, collectErrors, code, message, offset, html) {
  if (!collectErrors) {
    return;
  }
  const position = offset == null ? { line: null, column: null } : toLineCol(html, offset);
  errors.push(new ParseError(message, { category: "treebuilder", code, line: position.line, column: position.column }));
}

function toLineCol(text, offset) {
  const chunk = text.slice(0, Math.max(0, offset));
  const parts = chunk.split("\n");
  return {
    line: parts.length,
    column: parts[parts.length - 1].length + 1
  };
}
