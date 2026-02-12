# justjshtml

Dependency-free JavaScript HTML parser project inspired by `justhtml`.

## Current status
- Phase 0 implemented (smoke parser + tests).
- Core modular parser/tokenizer/tree-builder scaffold in place.
- Basic document/fragment parsing, serialization, query subset, stream API, and parse errors.
- Incremental html5lib tree smoke harness added.

## Usage

```js
import { JustHTML } from "justjshtml";

const doc = new JustHTML("<p>Hello</p>");
console.log(doc.toHTML());
```

## Development

```bash
npm test
```

Optional html5lib smoke run:

```bash
HTML5LIB_TESTS=../html5lib-tests/tree-construction npm run test:html5lib:tree:smoke
```
