const UTF8_BOM = [0xef, 0xbb, 0xbf];

export function decodeHTML(input, transportEncoding = null) {
  if (typeof input === "string") {
    return { text: input, encoding: null };
  }

  let bytes;
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    return { text: String(input ?? ""), encoding: null };
  }

  const sniffed = normalizeEncoding(transportEncoding) || sniffEncoding(bytes) || "windows-1252";
  const chosen = sniffed === "utf-7" ? "windows-1252" : sniffed;
  const decoderLabel = chosen === "windows-1252" ? "windows-1252" : chosen;
  const decoder = new TextDecoder(decoderLabel, { fatal: false });
  return { text: decoder.decode(bytes), encoding: chosen };
}

function sniffEncoding(bytes) {
  if (bytes.length >= 3 && bytes[0] === UTF8_BOM[0] && bytes[1] === UTF8_BOM[1] && bytes[2] === UTF8_BOM[2]) {
    return "utf-8";
  }

  const head = new TextDecoder("latin1", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 1024)));

  const charsetMatch = /<meta[^>]+charset\s*=\s*["']?\s*([^\s"'>/]+)/i.exec(head);
  if (charsetMatch) {
    return normalizeEncoding(charsetMatch[1]);
  }

  const pragmaMatch = /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^\s"';>]+)/i.exec(head);
  if (pragmaMatch) {
    return normalizeEncoding(pragmaMatch[1]);
  }

  return null;
}

function normalizeEncoding(label) {
  if (!label) {
    return null;
  }
  return String(label).trim().toLowerCase();
}
