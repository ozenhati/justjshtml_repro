import assert from "node:assert/strict";
import test from "node:test";

import { JustHTML, stream } from "../src/index.js";

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

test("phase 0 stream emits start/text/end events for simple tree", () => {
  const input = "<html><body><p>Hello</p></body></html>";
  const events = [...stream(input)];

  assert.deepEqual(events, [
    ["start", ["html", {}]],
    ["start", ["body", {}]],
    ["start", ["p", {}]],
    ["text", "Hello"],
    ["end", "p"],
    ["end", "body"],
    ["end", "html"]
  ]);
});
