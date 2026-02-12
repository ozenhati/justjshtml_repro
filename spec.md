# justjshtml API Specification (v0)

## Purpose
Define the user-facing API for a dependency-free JavaScript port of `justhtml` that can pass the full `html5lib-tests` suite.

## Product goals
- Match HTML5 parsing behavior of `justhtml` and browsers (tree construction + tokenizer recovery).
- Keep the API familiar to `justhtml` users.
- Run in browsers, Node.js, workers, and edge runtimes with no third-party dependencies.
- Provide both DOM-style and streaming-style parsing.
- Support byte input with HTML encoding sniffing behavior equivalent to the Python version.

## Non-goals (v0)
- Real browser DOM interop (native `Node` objects).
- CSS sanitization and transform pipeline parity on day 1.
- Script execution.

## Package surface

### Package name
`justjshtml`

### Primary exports
```js
import {
  JustHTML,
  parse,
  parseFragment,
  stream,
  FragmentContext,
  HTMLContext,
  StrictModeError,
  ParseError,
  Node,
  Document,
  DocumentFragment,
  Element,
  Text,
  Comment,
  Template,
} from 'justjshtml';
```

### Runtime/format targets
- ESM-first distribution.
- CJS compatibility build.
- Browser build as plain JS module.
- No dependency on Node built-ins for parser core.

## Core parsing API

### `new JustHTML(input, options?)`
Creates a parsed document object, matching Python `JustHTML(...)` semantics.

#### `input`
- `string`
- `Uint8Array` (including Node `Buffer`)
- `ArrayBuffer`

#### `options`
```js
{
  sanitize?: boolean,            // default true (reserved in v0; see note)
  safe?: boolean,                // alias of sanitize for parity
  collectErrors?: boolean,       // default false
  trackNodeLocations?: boolean,  // default false
  encoding?: string | null,      // transport-supplied encoding override
  fragment?: boolean,            // parse as fragment in default <div> context
  fragmentContext?: FragmentContextInit | FragmentContext,
  iframeSrcdoc?: boolean,        // default false
  scriptingEnabled?: boolean,    // default true
  strict?: boolean,              // throw StrictModeError on earliest parse error
}
```

`FragmentContextInit`:
```js
{ tagName: string, namespace?: 'svg' | 'math' | null }
```

#### Notes on `sanitize` in v0
- v0 will accept `sanitize`/`safe` for API compatibility.
- Until sanitizer lands, setting `sanitize: true` will be a no-op with a documented warning in docs (not runtime spam).
- Parser correctness and tree APIs are prioritized first.

### `JustHTML` instance properties
- `root: Document | DocumentFragment`
- `errors: ParseError[]` (ordered by source position; populated when `collectErrors` or `strict`)
- `encoding: string | null` (chosen encoding for byte input)

### `JustHTML` instance methods
- `toHTML(options?) => string`
- `toText(options?) => string`
- `toMarkdown(options?) => string` (optional in v0; may be staged to v1)
- `query(selector) => Node[]`
- `queryOne(selector) => Node | null`

#### `toHTML(options?)`
```js
{
  pretty?: boolean,      // default true
  indentSize?: number,   // default 2
  context?: HTMLContext, // default HTMLContext.HTML
  quote?: '"' | "'",    // default '"'
}
```

### Static escaping helpers on `JustHTML`
- `JustHTML.escapeJSString(value, options?)`
- `JustHTML.escapeAttrValue(value, options?)`
- `JustHTML.escapeURLValue(value)`
- `JustHTML.escapeURLInJSString(value, options?)`
- `JustHTML.escapeHTMLTextInJSString(value, options?)`

These mirror Python helper intent and naming, with JS casing.

## Convenience functions

### `parse(input, options?)`
Equivalent to `new JustHTML(input, options)`.

### `parseFragment(input, contextOrOptions?)`
Convenience wrapper that forces fragment parsing.

Accepted forms:
- `parseFragment(html)` -> default `<div>` HTML context
- `parseFragment(html, { tagName: 'tbody' })`
- `parseFragment(html, { context: { tagName: 'svg', namespace: 'svg' }, ...otherOptions })`

## Fragment contexts

### `new FragmentContext(tagName, namespace = null)`
Represents the HTML5 fragment parsing context element.

Properties:
- `tagName: string`
- `namespace: 'svg' | 'math' | null`

Behavior requirements:
- `fragmentContext` implies fragment parsing.
- Raw text/RCDATA context handling must match Python/HTML5 behavior (`textarea`, `title`, etc.).

## Node model

### Node classes
- `Node` (base)
- `Document`
- `DocumentFragment`
- `Element`
- `Template`
- `Text`
- `Comment`

### Required properties
All nodes:
- `name`
- `parent`
- `namespace`
- `originOffset`, `originLine`, `originCol`, `originLocation` (nullable, populated when tracking is enabled)

Container nodes:
- `children`

Element/template nodes:
- `attrs: Record<string, string | null>`

Text/comment nodes:
- `data`

Template node:
- `templateContent: DocumentFragment | null`

### Required methods
On `Node` (or equivalent where applicable):
- `toHTML(options?)`
- `toText(options?)`
- `query(selector)`
- `queryOne(selector)`
- `appendChild(node)`
- `removeChild(node)`
- `insertBefore(node, referenceNode)`
- `replaceChild(newNode, oldNode)`
- `hasChildNodes()`
- `cloneNode(deep = false)`

## Error API

### `ParseError`
Shape:
```js
{
  category: 'tokenizer' | 'treebuilder' | 'security',
  code: string,         // kebab-case
  message: string,
  line: number | null,  // 1-based
  column: number | null // 1-based
}
```

### `StrictModeError`
- Extends `SyntaxError`.
- Includes `.error` (the first `ParseError` by source order).

### Ordering rules
When multiple errors exist:
1. Sort by `line` ascending (unknown last).
2. Then `column` ascending (unknown last).
3. Stable by emission order for ties.

## Streaming API

### `stream(input, options?)`
Returns an iterable (and async-iterable in v1) of tokenizer events.

v0 sync signature:
```js
for (const [event, data] of stream(html, { encoding })) {
  // ...
}
```

Events:
- `['start', [tagName, attrs]]`
- `['end', tagName]`
- `['text', text]` (adjacent text coalesced)
- `['comment', data]`
- `['doctype', [name, publicId, systemId]]`

## Serialization contexts

### `HTMLContext`
Enum-like export:
- `HTML`
- `JS_STRING`
- `HTML_ATTR_VALUE`
- `URL`

Used by `toHTML({ context })` and helper methods.

## Selector API

v0 scope:
- Keep `query/queryOne` API stable.
- Implement a subset needed by current `justhtml` docs/tests first.
- Document unsupported selectors explicitly with deterministic errors.

## Encoding support

For byte input, decode using HTML precedence:
1. `options.encoding` transport override
2. BOM
3. `<meta charset>` / pragma scan in initial bytes
4. fallback to `windows-1252`

Additional rule:
- Treat unsafe `utf-7` labels as fallback to `windows-1252`.

## Compliance hooks for html5lib-tests

Expose internal-test utility (non-primary API):
- `toTestFormat(node)`

Purpose:
- Produce tree text format expected by `html5lib` tree-construction fixtures.
- Keep this exported but documented as test-oriented/stability-limited.

## Proposed implementation phases

### Phase 0: Smoke-test parser slice
- Implement a minimal end-to-end parser path for a small valid HTML document (for example `<!doctype html><html><body><p>Hello</p></body></html>`).
- Verify core outcomes: root type/name, expected element hierarchy, text extraction, and basic `toHTML()` round-trip.
- Add this as the first automated test to establish a fast green baseline before full spec coverage.


### Phase 1: Parser correctness foundation
- Port tokenizer + tree builder + node model.
- Implement `JustHTML`, `parse`, `parseFragment`, `FragmentContext`.
- Implement strict mode + parse error collection + ordering.
- Add `toTestFormat`.
- Pass html5lib tree-construction + tokenizer fixtures.

### Phase 2: Serialization and streaming
- Implement `toHTML`, `HTMLContext`, escaping helpers.
- Implement `stream()` with text coalescing.
- Pass serializer fixtures and verify streaming parity.

### Phase 3: Encoding
- Implement byte input decoding and sniffing.
- Pass html5lib encoding fixtures.

### Phase 4: Selector and ergonomics
- Add `query/queryOne` coverage.
- Add convenience docs and migration examples from Python.

### Phase 5: Sanitization/transforms parity
- Port `sanitize` and transform pipeline APIs.
- Remove v0 sanitize no-op status.

## Naming and compatibility decisions
- Keep `JustHTML` class name for Python parity.
- Use JS-style method casing (`toHTML`, `toText`) and offer Python-alias shims (`to_html`, `to_text`) only if needed for migration.
- Keep option names close to Python but in camelCase for JS idiom.
- Keep `safe` alias for backward mental model, but document `sanitize` as preferred.

## Minimal example

```js
import { JustHTML, FragmentContext } from 'justjshtml';

const doc = new JustHTML('<tr><td>x</td></tr>', {
  fragmentContext: new FragmentContext('tbody'),
  collectErrors: true,
});

console.log(doc.root.name);         // '#document-fragment'
console.log(doc.toHTML());          // '<tr><td>x</td></tr>'
console.log(doc.queryOne('td')?.toText());
```

## Open decisions (to settle before implementation starts)
- Whether `toMarkdown` ships in v0 or v1.
- Whether to include Python-style alias methods (`to_html`, `query_one`) in initial release.
- Whether `stream()` should be sync-only in v0 or support async iterables immediately.
- Whether parser internals are split into `core` and `extras` entry points for bundle size.
