/**
 * Splits a multi-statement PostgreSQL SQL string into individual executable statements.
 *
 * Correctly handles all PostgreSQL quoting and comment contexts so that semicolons
 * inside function bodies, string literals, or comments are never treated as statement
 * terminators:
 *
 *   - Dollar-quoted blocks:  $$ ... $$ and $tag$ ... $tag$
 *   - Single-quoted strings: '...' with '' as the escape sequence for a literal quote
 *   - Line comments:         -- ...
 *   - Block comments:        slash-star ... star-slash
 *
 * Entries that contain only whitespace or comments after stripping are dropped so
 * nothing empty is sent to the database.
 *
 * @param sql - Full SQL file contents, potentially containing many statements
 * @returns Ordered array of individual SQL statements, each retaining its trailing semicolon
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

    // 1. Line comment: consume from -- through the end of the line
    if (ch === "-" && sql[i + 1] === "-") {
      const newline = sql.indexOf("\n", i + 2);
      if (newline === -1) {
        current += sql.slice(i);
        i = len;
      } else {
        current += sql.slice(i, newline + 1);
        i = newline + 1;
      }
      continue;
    }

    // 2. Block comment: consume from /* through the closing */
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) {
        current += sql.slice(i);
        i = len;
      } else {
        current += sql.slice(i, end + 2);
        i = end + 2;
      }
      continue;
    }

    // 3. Single-quoted string: '' is an escaped literal quote, not a terminator
    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2; // escaped quote — skip both characters
        } else if (sql[j] === "'") {
          j++; // closing quote
          break;
        } else {
          j++;
        }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // 4. Dollar-quoted block: $tag$...$tag$ where tag matches [A-Za-z0-9_]*
    //    Captures the full opening tag then scans for the identical closing tag,
    //    consuming all semicolons inside the block as part of the statement body.
    if (ch === "$") {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
        j++;
      }
      if (j < len && sql[j] === "$") {
        const tag = sql.slice(i, j + 1); // e.g. "$$" or "$body$"
        const closeIdx = sql.indexOf(tag, j + 1);
        if (closeIdx === -1) {
          current += sql.slice(i);
          i = len;
        } else {
          current += sql.slice(i, closeIdx + tag.length);
          i = closeIdx + tag.length;
        }
        continue;
      }
      // Not a dollar-quote (e.g. a bare $1 positional param already inside a
      // dollar-quoted block we consumed earlier) — fall through to normal char.
    }

    // 5. Statement terminator
    if (ch === ";") {
      current += ";";
      const trimmed = current.trim();
      if (isExecutable(trimmed)) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Flush any trailing content that has no closing semicolon
  const trimmed = current.trim();
  if (trimmed && isExecutable(trimmed)) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * Returns true when a SQL fragment contains actual executable content rather than
 * only whitespace and comments.  Used to drop header-comment-only leading blocks.
 */
function isExecutable(sql: string): boolean {
  const noLineComments = sql.replace(/--[^\n]*/g, "");
  const noComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
  return noComments.replace(/;/g, "").trim().length > 0;
}
