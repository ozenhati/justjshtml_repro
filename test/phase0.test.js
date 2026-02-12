import assert from "node:assert/strict";
import test from "node:test";

import { JustHTML } from "../src/index.js";

test("phase 0 smoke test: parse simple valid document and return expected core results", () => {
  const input = "<!doctype html><html><body><p>Hello</p></body></html>";
  const doc = new JustHTML(input, { collectErrors: true });

  assert.equal(doc.root.name, "#document");

  const htmlNode = doc.root.children.find((n) => n.name === "html");
  assert.ok(htmlNode, "document should contain html element");

  const bodyNode = htmlNode.children.find((n) => n.name === "body");
  assert.ok(bodyNode, "html should contain body element");

  const paragraph = bodyNode.children.find((n) => n.name === "p");
  assert.ok(paragraph, "body should contain p element");

  assert.equal(paragraph.toText(), "Hello");
  assert.equal(doc.toText(), "Hello");
  assert.equal(doc.toHTML({ pretty: false }), input);
});
