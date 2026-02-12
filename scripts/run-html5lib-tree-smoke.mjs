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
      const expectedCandidates = Object.values(tc.documents || {}).filter(Boolean);
      if (!expectedCandidates.length) {
        continue;
      }

      const doc = tc.fragmentContext
      ? parseFragment(tc.data, tc.fragmentContext)
      : new JustHTML(tc.data, { collectErrors: true });

      const actual = normalizeLines(toTestFormat(doc.root));
      const expected = expectedCandidates.map((value) => normalizeLines(value));

      if (expected.includes(actual)) {
        passed += 1;
      } else {
        failed += 1;
        console.log(`FAIL ${path.basename(filePath)}#${i + 1}`);
        console.log("Input:");
        console.log(tc.data);
        console.log("Expected (acceptable variants):");
        for (const item of expected) {
          console.log(item);
          console.log("...");
        }
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
  let scriptMode = "default";

  for (const line of lines) {
    if (line.startsWith("#")) {
      const directive = line.slice(1).trim();
      if (directive === "data") {
        if (current && (current.data || Object.keys(current.documents).length > 0)) {
          out.push(current);
        }
        current = { data: "", documents: {}, fragmentContext: null };
        mode = "data";
        scriptMode = "default";
        continue;
      }
      if (!current) {
        continue;
      }
      if (directive === "script-on" || directive === "script-off") {
        scriptMode = directive;
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
      current.documents[scriptMode] = `${current.documents[scriptMode] || ""}${line}\n`;
      continue;
    }
    if (mode === "document-fragment") {
      current.fragmentContext = parseFragmentContext(line.trim());
      continue;
    }
  }

  if (current && (current.data || Object.keys(current.documents).length > 0)) {
    out.push(current);
  }

  for (const tc of out) {
    tc.data = tc.data.replace(/\n$/, "");
    for (const key of Object.keys(tc.documents)) {
      tc.documents[key] = tc.documents[key].replace(/\n$/, "");
    }
  }

  return out;
}

function parseFragmentContext(value) {
  if (!value) {
    return null;
  }
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && (parts[0] === "svg" || parts[0] === "math")) {
    return { namespace: parts[0], tagName: parts[1] };
  }
  return { tagName: value };
}

function normalizeLines(value) {
  return value
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .trim();
}
