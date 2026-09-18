// locales/zh-CN/commands.ts
// Assembler: edit the individual files in commands/ instead.
//
// Only the command slices translated so far are imported here. Add each remaining
// `./commands/<name>` import and its spread alongside its translation: an import of a file
// that does not exist yet fails TypeScript resolution for the whole project, and the other
// locale slices already cover `commands/` in the meantime.

import tool from "./commands/tool";
import persona from "./commands/persona";
import help from "./commands/help";
import config from "./commands/config";
import server from "./commands/server";
import personal from "./commands/personal";

export default {
  commands: {
    ...persona,
    ...help,
    ...tool,
    ...config,
    ...server,
    ...personal,
  },
};
