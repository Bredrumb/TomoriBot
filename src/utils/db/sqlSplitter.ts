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
          j += 2;
        } else if (sql[j] === "'") {
          j++;
          break;
        } else {
          j++;
        }
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Consume $tag$...$tag$ dollar-quoted blocks together so internal semicolons do not split the statement.
    if (ch === "$") {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(sql[j])) {
        j++;
      }
      if (j < len && sql[j] === "$") {
        const tag = sql.slice(i, j + 1);
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
      // Fall through when $ starts a positional parameter (e.g., $1) rather than a $tag$ quote.
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
