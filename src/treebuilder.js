import { VOID_ELEMENTS } from "./constants.js";
import { ParseError } from "./errors.js";
import { Comment, Doctype, Document, DocumentFragment, Element, Template, Text } from "./node.js";
import { TokenKind } from "./tokenizer.js";

const HEAD_TAGS = new Set(["base", "link", "meta", "noscript", "script", "style", "template", "title"]);

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
          const element = createElement(name, token.attrs);
          maybeSetLocation(element, token.pos, html, trackNodeLocations);
          currentNode(stack, root).appendChild(element);
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
            documentElement = createElement("html", token.attrs);
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
            headElement = createElement("head", token.attrs);
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
            bodyElement = createElement("body", token.attrs);
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
          const fostered = createElement(name, token.attrs);
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

        const element = createElement(name, token.attrs);
        maybeSetLocation(element, token.pos, html, trackNodeLocations);
        parent.appendChild(element);
        if (!token.selfClosing && !VOID_ELEMENTS.has(name)) {
          stack.push(element);
        }
        break;
      }
      case TokenKind.END_TAG: {
        const foundIndex = findOpenElement(stack, token.name);
        if (foundIndex < 0) {
          pushTreeError(errors, collectErrors, "unexpected-end-tag", `Unexpected </${token.name}> end tag`, token.pos, html);
          break;
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

function createElement(name, attrs) {
  if (name === "template") {
    return new Template(name, attrs || {});
  }
  return new Element(name, attrs || {});
}

function ensureScaffold(root, getState, setState) {
  const state = getState();
  let { documentElement, headElement, bodyElement } = state;

  if (!documentElement) {
    documentElement = new Element("html", {});
    root.appendChild(documentElement);
  }
  if (!headElement) {
    headElement = new Element("head", {});
    documentElement.appendChild(headElement);
  }
  if (!bodyElement) {
    bodyElement = new Element("body", {});
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
  if (tagName === "caption" || tagName === "colgroup" || tagName === "tbody" || tagName === "tfoot" || tagName === "thead" || tagName === "tr") {
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
    tbody = new Element("tbody", {});
    table.appendChild(tbody);
  }
  const tr = new Element("tr", {});
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
