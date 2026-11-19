export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const len = sql.length;

  while (i < len) {
    const ch = sql[i];

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

    if (ch === "'") {
      let j = i + 1;
      while (j < len) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2; // escaped quote: skip both characters
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

    // Dollar-quoted block: $tag$...$tag$ where tag matches [A-Za-z0-9_]*
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
      // dollar-quoted block we consumed earlier): fall through to normal char.
    }

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

function isExecutable(sql: string): boolean {
  const noLineComments = sql.replace(/--[^\n]*/g, "");
  const noComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, "");
  return noComments.replace(/;/g, "").trim().length > 0;
}
