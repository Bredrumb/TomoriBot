// locales/zh-CN/commands.ts
// Assembler: edit the individual files in commands/ instead.
//
// Only the command slices translated so far are imported here. Add each remaining
// `./commands/<name>` import and its spread alongside its translation: an import of a file
// that does not exist yet fails TypeScript resolution for the whole project, and the other
// locale slices already cover `commands/` in the meantime.

import transfer from "./commands/transfer";
import memories from "./commands/memories";
import providers from "./commands/providers";
import moderation from "./commands/moderation";
import learn from "./commands/learn";
import tool from "./commands/tool";
import status from "./commands/status";
import persona from "./commands/persona";
import help from "./commands/help";
import novelai from "./commands/novelai";
import config from "./commands/config";
import server from "./commands/server";
import personal from "./commands/personal";
import generate from "./commands/generate";
import stats from "./commands/stats";
import setup from "./commands/setup";
import compact from "./commands/compact";

export default {
  commands: {
    ...transfer,
    ...memories,
    ...providers,
    ...moderation,
    ...learn,
    ...tool,
    ...status,
    ...persona,
    ...help,
    ...novelai,
    ...config,
    ...server,
    ...personal,
    ...generate,
    ...stats,
    ...setup,
    ...compact,
  },
};
