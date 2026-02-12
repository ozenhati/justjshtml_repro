import { HTML5_NAMED_ENTITIES } from "./entities-data.js";

const MAX_NAMED_ENTITY_LENGTH = Object.keys(HTML5_NAMED_ENTITIES).reduce((max, key) => Math.max(max, key.length), 0);

const C1_REPLACEMENTS = new Map([
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e], [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021],
  [0x88, 0x02c6], [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152], [0x8e, 0x017d], [0x91, 0x2018],
  [0x92, 0x2019], [0x93, 0x201c], [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014], [0x98, 0x02dc],
  [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a], [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178]
]);

export function decodeCharacterReferences(value, { inAttribute = false } = {}) {
  const input = String(value || "");
  let out = "";
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (ch !== "&") {
      out += ch;
      i += 1;
      continue;
    }

    const decoded = decodeOne(input, i, inAttribute);
    if (!decoded) {
      out += "&";
      i += 1;
      continue;
    }

    out += decoded.value;
    i = decoded.nextIndex;
  }

  return out;
}

function decodeOne(input, ampIndex, inAttribute) {
  const next = input[ampIndex + 1] || "";
  if (!next || /\s/.test(next)) {
    return null;
  }

  if (next === "#") {
    return decodeNumeric(input, ampIndex, inAttribute);
  }
  return decodeNamed(input, ampIndex, inAttribute);
}

function decodeNumeric(input, ampIndex, inAttribute) {
  let i = ampIndex + 2;
  let radix = 10;
  if ((input[i] || "").toLowerCase() === "x") {
    radix = 16;
    i += 1;
  }
  const digitStart = i;
  while (i < input.length && isRadixDigit(input[i], radix)) {
    i += 1;
  }
  if (i === digitStart) {
    return null;
  }

  const hasSemicolon = input[i] === ";";
  const nextIndex = hasSemicolon ? i + 1 : i;
  if (!hasSemicolon && inAttribute && isAsciiAlnumOrEq(input[i] || "")) {
    return null;
  }

  const raw = input.slice(digitStart, i);
  let cp = Number.parseInt(raw, radix);
  if (!Number.isFinite(cp)) {
    cp = 0xfffd;
  }

  cp = normalizeCodePoint(cp);
  return { value: String.fromCodePoint(cp), nextIndex };
}

function decodeNamed(input, ampIndex, inAttribute) {
  const upper = Math.min(input.length, ampIndex + 1 + MAX_NAMED_ENTITY_LENGTH);
  for (let end = upper; end > ampIndex + 1; end -= 1) {
    const key = input.slice(ampIndex + 1, end);
    const resolved = HTML5_NAMED_ENTITIES[key];
    if (resolved == null) {
      continue;
    }

    const hasSemicolon = key.endsWith(";");
    const nextChar = input[end] || "";
    if (!hasSemicolon && inAttribute && isAsciiAlnumOrEq(nextChar)) {
      continue;
    }

    return { value: resolved, nextIndex: end };
  }
  return null;
}

function isAsciiAlnumOrEq(ch) {
  return /^[0-9A-Za-z=]$/.test(ch);
}

function isRadixDigit(ch, radix) {
  if (radix === 10) {
    return /^[0-9]$/.test(ch);
  }
  return /^[0-9A-Fa-f]$/.test(ch);
}

function normalizeCodePoint(codePoint) {
  if (C1_REPLACEMENTS.has(codePoint)) {
    return C1_REPLACEMENTS.get(codePoint);
  }
  if (codePoint === 0x00) {
    return 0xfffd;
  }
  if (codePoint > 0x10ffff) {
    return 0xfffd;
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return 0xfffd;
  }
  return codePoint;
}
