# justjshtml

`justjshtml` is a dependency-free JavaScript HTML parser inspired by [justhtml](https://github.com/EmilStenstrom/justhtml).
Background: this project was recreated with codex-5.3 to compare time taken and token consumption against an earlier model generation.

It is designed to run in:
- Browsers (via ES modules)
- Node.js (via ES modules)
- Other JS runtimes that support standard ESM

The long-term goal is high compatibility with `html5lib-tests` tree-construction behavior while keeping a minimal, zero-dependency implementation.

## Attribution / Acknowledgements

- **JustHTML (Python)** by Emil Stenstrom: `justjshtml` is a JavaScript port intended to match its behavior and API surface where practical. <https://github.com/EmilStenstrom/justhtml>
- **html5lib-tests** by the html5lib project: used as the primary conformance test suite. <https://github.com/html5lib/html5lib-tests>
- **html5ever** by the Servo project: JustHTML started as a Python port of html5ever, and that architecture heavily influenced this port as well. <https://github.com/servo/html5ever>
- **Simon Willison**: playground UI work here recreates/adapts the JustHTML tool experience from <https://tools.simonwillison.net/justhtml>, implemented fully in JavaScript (no Pyodide). Additional background and context: <https://simonwillison.net/2025/Dec/15/porting-justhtml/>

## Status

Implemented today:
- `JustHTML` parse API (document + fragment)
- Node tree model (`Document`, `Element`, `Text`, etc.)
- Serialization (`toHTML`) and text extraction (`toText`)
- Basic selector querying (`query`, `queryOne`)
- Streaming token events (`stream`)
- Parse error collection + strict mode
- Encoding support for byte input (transport/meta fallback behavior)
- Local playground: `playground.html`

In progress:
- Continued alignment with broader `html5lib-tests` coverage
- Full algorithm parity for all adoption-agency/tree edge cases

## Quick start

Clone and test:

```bash
git clone https://github.com/ozenhati/justjshtml.git
cd justjshtml
npm test
```

## API quick usage

```js
import { JustHTML } from "./src/index.js";

const doc = new JustHTML("<p>Hello <b>world</b></p>");
console.log(doc.toText()); // Hello world
console.log(doc.toHTML({ pretty: true }));
```

## Use in HTML (Browser)

Because this project currently ships as source modules, import from `./src/index.js`:

```html
<!doctype html>
<html>
  <body>
    <script type="module">
      import { JustHTML, stream } from "./src/index.js";

      const doc = new JustHTML("<div><p id='x'>Hi</p></div>");
      const p = doc.queryOne("#x");
      console.log(p?.toText());

      for (const [event, data] of stream("<p>Hello</p>")) {
        console.log(event, data);
      }
    </script>
  </body>
</html>
```

Important:
- Serve via HTTP (`http://localhost:...`), not `file://`, so ESM imports resolve correctly.

## Use in Node.js

Node 18+ with ESM works directly.

`package.json` (example app):

```json
{
  "type": "module"
}
```

`example.mjs`:

```js
import { JustHTML, parseFragment } from "./src/index.js";

const doc = new JustHTML("<!doctype html><html><body><h1>Title</h1></body></html>");
console.log(doc.queryOne("h1")?.toText());

const frag = parseFragment("<li>One</li><li>Two</li>");
console.log(frag.toHTML({ pretty: false }));
```

Run:

```bash
node example.mjs
```

## Core API reference (current)

### `new JustHTML(input, options?)`

`input`:
- `string`
- `Uint8Array` / `Buffer`
- `ArrayBuffer`

Selected `options`:
- `fragment: boolean`
- `fragmentContext`
- `collectErrors: boolean`
- `strict: boolean`
- `trackNodeLocations: boolean`
- `encoding: string`
- `sanitize`, `safe` (compatibility options; sanitize pipeline parity is still in progress)

### Instance methods

- `query(selector)`
- `queryOne(selector)`
- `toHTML(options?)`
- `toText(options?)`

Python-style aliases currently supported:
- `query_one(...)`
- `to_html(...)`
- `to_text(...)`

### Helpers

- `parse(input, options?)`
- `parseFragment(input, contextOrOptions?)`
- `stream(input, options?)`

### Node classes

Exports include:
- `Node`
- `Document`
- `DocumentFragment`
- `Element`
- `Template`
- `Text`
- `Comment`
- `Doctype`

### Errors

- `ParseError`
- `StrictModeError`

## Playground

A full local playground UI is included at:

- `playground.html`

Run it locally:

```bash
python3 -m http.server 8000
```

Then open:

- <http://localhost:8000/playground.html>

The playground mirrors the Simon Willison JustHTML tool behavior, but executes this JavaScript library directly instead of Pyodide/Python.

## Development workflow

### Run unit tests

```bash
npm test
```

### Run html5lib tree smoke harness

```bash
HTML5LIB_TESTS=../html5lib-tests/tree-construction npm run test:html5lib:tree:smoke
```

Optional scope controls:

```bash
MAX_FILES=5 MAX_CASES_PER_FILE=25 \
HTML5LIB_TESTS=../html5lib-tests/tree-construction \
npm run test:html5lib:tree:smoke
```

## How this was built

The implementation was developed iteratively with a test-first loop:

1. Define API and roadmap in `spec.md`
2. Implement a minimal parser slice (Phase 0)
3. Split into modular parser components (`tokenizer`, `treebuilder`, `serialize`, `stream`, `encoding`, `node`)
4. Add compatibility layers for Python-like API ergonomics
5. Continuously validate against local smoke tests and selected `html5lib-tests` fixtures
6. Refine edge-case handling (adoption and table/doctype/comment behaviors) through targeted fixes

This keeps progress measurable while preserving a clean dependency-free architecture.

## Project layout

- `src/index.js` - public exports
- `src/parser.js` - `JustHTML` and parse entry points
- `src/tokenizer.js` - tokenization
- `src/treebuilder.js` - tree construction and recovery heuristics
- `src/node.js` - node model
- `src/serialize.js` - HTML + test-format serialization
- `src/stream.js` - stream event API
- `src/encoding.js` - byte decode/sniffing helpers
- `scripts/run-html5lib-tree-smoke.mjs` - tree smoke harness
- `playground.html` - local interactive playground
- `spec.md` - API and roadmap spec

## License

See `LICENSE`.
