import assert from "node:assert/strict";
import test from "node:test";

import { FragmentContext, HTMLContext, JustHTML, parseFragment, stream } from "../src/index.js";

test("smoke test: parse simple valid document and core outcomes", () => {
  const input = "<!doctype html><html><body><p>Hello</p></body></html>";
  const doc = new JustHTML(input, { collectErrors: true });

  assert.equal(doc.root.name, "#document");

  const htmlNode = doc.root.queryOne("html");
  assert.ok(htmlNode);

  const bodyNode = doc.root.queryOne("body");
  assert.ok(bodyNode);

  const paragraph = doc.root.queryOne("p");
  assert.ok(paragraph);

  assert.equal(paragraph.toText(), "Hello");
  assert.equal(doc.toText(), "Hello");
  assert.equal(doc.toHTML({ pretty: false }), "<!doctype html><html><head></head><body><p>Hello</p></body></html>");
  assert.deepEqual(doc.errors, []);
});

test("document mode inserts html/head/body scaffolding for snippets", () => {
  const doc = new JustHTML("<p>Hello</p>");
  assert.equal(doc.toHTML({ pretty: false }), "<html><head></head><body><p>Hello</p></body></html>");
});

test("fragment mode does not insert document scaffolding", () => {
  const doc = parseFragment("<p>Hello</p>");
  assert.equal(doc.root.name, "#document-fragment");
  assert.equal(doc.toHTML({ pretty: false }), "<p>Hello</p>");
});

test("fragment mode accepts explicit FragmentContext", () => {
  const doc = parseFragment("<tr><td>x</td></tr>", new FragmentContext("tbody"));
  assert.equal(doc.root.name, "#document-fragment");
  assert.equal(doc.queryOne("td").toText(), "x");
});

test("selector subset supports tag, #id and .class", () => {
  const doc = new JustHTML('<div id="a" class="x y"><span class="y">ok</span></div>');
  assert.equal(doc.query("div").length, 1);
  assert.equal(doc.query("#a").length, 1);
  assert.equal(doc.query(".y").length, 2);
  assert.equal(doc.query("span.y").length, 1);
});

test("collect_errors captures unmatched end tags", () => {
  const doc = new JustHTML("<p>hi</div>", { collectErrors: true });
  assert.equal(doc.errors.length, 2);
  assert.equal(doc.errors[0].code, "unexpected-end-tag");
  assert.equal(doc.errors[1].code, "expected-closing-tag-but-got-eof");
});

test("strict mode throws earliest parse error", () => {
  assert.throws(() => new JustHTML("<p>hi</div>", { strict: true }), /Unexpected <\/div> end tag/);
});

test("track_node_locations fills origin metadata", () => {
  const doc = new JustHTML("<p>Hello</p>", { trackNodeLocations: true });
  const p = doc.queryOne("p");
  assert.ok(p.originOffset !== null);
  assert.ok(p.originLine !== null);
  assert.ok(p.originCol !== null);
  assert.ok(Array.isArray(p.originLocation));
});

test("toHTML supports pretty output", () => {
  const doc = new JustHTML("<div><span>Hi</span></div>");
  assert.equal(doc.toHTML({ pretty: true, indentSize: 2 }), "<html>\n  <head></head>\n  <body>\n    <div>\n      <span>Hi</span>\n    </div>\n  </body>\n</html>");
});

test("toHTML supports serialization contexts", () => {
  const doc = new JustHTML("<p>x&y</p>");
  const html = doc.toHTML({ pretty: false });
  assert.equal(html, "<html><head></head><body><p>x&amp;y</p></body></html>");
  assert.equal(
    doc.toHTML({ pretty: false, context: HTMLContext.JS_STRING }),
    "\\u003chtml\\u003e\\u003chead\\u003e\\u003c/head\\u003e\\u003cbody\\u003e\\u003cp\\u003ex&amp;y\\u003c/p\\u003e\\u003c/body\\u003e\\u003c/html\\u003e"
  );
  assert.equal(doc.toHTML({ pretty: false, context: HTMLContext.HTML_ATTR_VALUE }), "&lt;html&gt;&lt;head&gt;&lt;/head&gt;&lt;body&gt;&lt;p&gt;x&amp;amp;y&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;");
});

test("stream emits tokenizer event sequence and coalesces text", () => {
  const events = [...stream("<p>Hello<!--x--> world</p>")];
  assert.deepEqual(events, [
    ["start", ["p", {}]],
    ["text", "Hello"],
    ["comment", "x"],
    ["text", " world"],
    ["end", "p"]
  ]);
});

test("byte input sets encoding and decodes", () => {
  const bytes = new TextEncoder().encode("<p>ok</p>");
  const doc = new JustHTML(bytes);
  assert.equal(doc.encoding, "windows-1252");
  assert.equal(doc.toText(), "ok");
});
