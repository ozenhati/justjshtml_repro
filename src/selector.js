export function query(root, selector) {
  if (!root || typeof root.query !== "function") {
    throw new Error("query() expects a node-like root with a query() method");
  }
  return root.query(selector);
}

export function matches(node, selector) {
  if (!node || !node.parent || typeof node.parent.query !== "function") {
    return false;
  }
  const found = node.parent.query(selector);
  return found.includes(node);
}
