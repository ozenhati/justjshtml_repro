export class ParseError extends Error {
  constructor(message, { category = "tokenizer", code = "parse-error", line = null, column = null } = {}) {
    super(message);
    this.name = "ParseError";
    this.category = category;
    this.code = code;
    this.line = line;
    this.column = column;
  }
}

export class StrictModeError extends SyntaxError {
  constructor(error) {
    super(error?.message || "Strict parsing failed");
    this.name = "StrictModeError";
    this.error = error;
  }
}

export function sortErrors(errors) {
  return errors
    .map((error, idx) => ({ error, idx }))
    .sort((a, b) => {
      const aLine = a.error.line == null ? Number.MAX_SAFE_INTEGER : a.error.line;
      const bLine = b.error.line == null ? Number.MAX_SAFE_INTEGER : b.error.line;
      if (aLine !== bLine) {
        return aLine - bLine;
      }
      const aCol = a.error.column == null ? Number.MAX_SAFE_INTEGER : a.error.column;
      const bCol = b.error.column == null ? Number.MAX_SAFE_INTEGER : b.error.column;
      if (aCol !== bCol) {
        return aCol - bCol;
      }
      return a.idx - b.idx;
    })
    .map((entry) => entry.error);
}
