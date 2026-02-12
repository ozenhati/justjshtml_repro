import { VOID_ELEMENTS } from "./constants.js";
import { ParseError } from "./errors.js";
import { Comment, Doctype, Document, DocumentFragment, Element, Template, Text } from "./node.js";
import { TokenKind } from "./tokenizer.js";

const HEAD_TAGS = new Set(["base", "link", "meta", "noscript", "script", "style", "template", "title"]);
const FORMATTING_TAGS = new Set(["a", "b", "big", "code", "em", "font", "i", "nobr", "s", "small", "strike", "strong", "tt", "u"]);
const CLOSE_P_ON_START = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "dl",
  "fieldset",
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
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
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

  let documentElement = null;
  let headElement = null;
  let bodyElement = null;

  const stack = [root];

  for (const token of tokens) {
    switch (token.kind) {
      case TokenKind.DOCTYPE: {
        if (fragment) {
          break;
        }
        const dt = new Doctype(token.name, token.publicId, token.systemId);
        maybeSetLocation(dt, token.pos, html, trackNodeLocations);
        root.appendChild(dt);
        break;
      }
      case TokenKind.COMMENT: {
        const comment = new Comment(token.data);
        maybeSetLocation(comment, token.pos, html, trackNodeLocations);
        currentNode(stack, root, bodyElement).appendChild(comment);
        break;
      }
      case TokenKind.TEXT: {
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
        const textNode = new Text(token.data);
        maybeSetLocation(textNode, token.pos, html, trackNodeLocations);
        if (!fragment && shouldFosterParentText(stack)) {
          fosterParentInsert(textNode, stack, bodyElement);
        } else {
          currentNode(stack, root, bodyElement).appendChild(textNode);
        }
        break;
      }
      case TokenKind.START_TAG: {
        const name = token.name;
        if (fragment) {
          const parent = currentNode(stack, root);
          const ns = inferNamespace(name, parent);
          const element = createElement(name, token.attrs, ns);
          maybeSetLocation(element, token.pos, html, trackNodeLocations);
          parent.appendChild(element);
          if (!token.selfClosing && !VOID_ELEMENTS.has(name)) {
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
          }
          ensureDocumentOnStack(stack, documentElement);
          stack.length = 2;
          stack.push(bodyElement);
          break;
        }

        let parent = chooseParent(stack, bodyElement, headElement, name);
        alignStackForParent(stack, parent, documentElement, headElement, bodyElement);

        if (!fragment && shouldFosterParentElement(stack, name)) {
          const fosterParent = findFosterParent(stack, bodyElement);
          const ns = inferNamespace(name, fosterParent);
          const fostered = createElement(name, token.attrs, ns);
          maybeSetLocation(fostered, token.pos, html, trackNodeLocations);
          fosterParentInsert(fostered, stack, bodyElement);
          if (!token.selfClosing && !VOID_ELEMENTS.has(name)) {
            stack.push(fostered);
          }
          break;
        }

        if (!fragment && (name === "td" || name === "th")) {
          ensureTableCellContext(stack, bodyElement);
          parent = currentNode(stack, root, bodyElement);
        }

        let reopenInsideNewElement = [];
        if (!fragment && CLOSE_P_ON_START.has(name)) {
          const pIndex = findOpenElement(stack, "p");
          if (pIndex >= 0) {
            if (name === "p") {
              const above = stack.slice(pIndex + 1);
              reopenInsideNewElement = above
                .filter((node) => FORMATTING_TAGS.has(node.name))
                .slice(0, -1)
                .map((node) => ({ name: node.name, attrs: { ...(node.attrs || {}) } }));
            }
            stack.length = pIndex;
            parent = currentNode(stack, root, bodyElement);
          }
        }

        const ns = inferNamespace(name, parent);
        const element = createElement(name, token.attrs, ns);
        maybeSetLocation(element, token.pos, html, trackNodeLocations);
        parent.appendChild(element);
        if (!token.selfClosing && !VOID_ELEMENTS.has(name)) {
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
        const foundIndex = findOpenElement(stack, token.name);
        if (foundIndex < 0) {
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
  if (!bodyElement) {
    bodyElement = new Element("body", {}, "html");
    documentElement.appendChild(bodyElement);
  }

  setState({ documentElement, headElement, bodyElement });
}

function chooseParent(stack, bodyElement, headElement, tagName) {
  const current = currentNode(stack, null, bodyElement);
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
  if (formatting.name === "b") {
    formattingPrefix = formattingPrefix.filter((node) => node.name === "b");
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

function findNearestIndex(stack, name) {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (stack[i] && stack[i].name === name) {
      return i;
    }
  }
  return -1;
}

function inferNamespace(tagName, parent) {
  if (tagName === "svg") {
    return "svg";
  }
  if (tagName === "math") {
    return "math";
  }
  if (parent && parent.namespace && parent.namespace !== "html") {
    return parent.namespace;
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
