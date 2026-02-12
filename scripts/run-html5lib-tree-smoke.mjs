import fs from "node:fs";
import path from "node:path";

import { JustHTML, parseFragment, toTestFormat } from "../src/index.js";

const testsRoot = process.env.HTML5LIB_TESTS || path.resolve("../html5lib-tests/tree-construction");
const maxFiles = Number(process.env.MAX_FILES || 3);
const maxCasesPerFile = Number(process.env.MAX_CASES_PER_FILE || 20);

if (!fs.existsSync(testsRoot)) {
  console.error(`html5lib tree-construction fixtures not found: ${testsRoot}`);
  console.error("Set HTML5LIB_TESTS=/path/to/html5lib-tests/tree-construction");
  process.exit(1);
}

const files = fs
  .readdirSync(testsRoot)
  .filter((name) => name.endsWith(".dat"))
  .sort()
  .slice(0, maxFiles)
  .map((name) => path.join(testsRoot, name));

let passed = 0;
let failed = 0;

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf8");
  const cases = parseDat(content).slice(0, maxCasesPerFile);

  for (let i = 0; i < cases.length; i += 1) {
    const tc = cases[i];
    if (!tc.document) {
      continue;
    }

    const doc = tc.fragment
      ? parseFragment(tc.data, { tagName: tc.fragment })
      : new JustHTML(tc.data, { collectErrors: true });

    const actual = normalizeLines(toTestFormat(doc.root));
    const expected = normalizeLines(tc.document);

    if (actual === expected) {
      passed += 1;
    } else {
      failed += 1;
      console.log(`FAIL ${path.basename(filePath)}#${i + 1}`);
      console.log("Input:");
      console.log(tc.data);
      console.log("Expected:");
      console.log(expected);
      console.log("Actual:");
      console.log(actual);
      console.log("---");
    }
  }
}

console.log(`tree smoke: passed=${passed} failed=${failed}`);
if (failed > 0) {
  process.exitCode = 1;
}

function parseDat(content) {
  const out = [];
  const lines = content.split("\n");
  let current = null;
  let mode = null;

  for (const line of lines) {
    if (line.startsWith("#")) {
      const directive = line.slice(1).trim();
      if (directive === "data") {
        if (current && (current.data || current.document)) {
          out.push(current);
        }
        current = { data: "", document: "", fragment: null };
        mode = "data";
        continue;
      }
      if (!current) {
        continue;
      }
      mode = directive;
      continue;
    }

    if (!current) {
      continue;
    }

    if (mode === "data") {
      current.data += `${line}\n`;
      continue;
    }
    if (mode === "document") {
      current.document += `${line}\n`;
      continue;
    }
    if (mode === "document-fragment") {
      current.fragment = line.trim();
      continue;
    }
  }

  if (current && (current.data || current.document)) {
    out.push(current);
  }

  for (const tc of out) {
    tc.data = tc.data.replace(/\n$/, "");
    tc.document = tc.document.replace(/\n$/, "");
  }

  return out;
}

function normalizeLines(value) {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}
