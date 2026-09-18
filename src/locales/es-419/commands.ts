// locales/es-419/commands.ts
// Assembler: edit the individual files in commands/ instead.

import learn from "./commands/learn";
import choices from "../en-US/commands/choices";
import stPreset from "../en-US/commands/st-preset";
import stPresets from "../en-US/commands/st-presets";
import tool from "./commands/tool";
import status from "./commands/status";
import data from "../en-US/commands/data";
import persona from "./commands/persona";
import help from "./commands/help";
import legal from "../en-US/commands/legal";
import novelai from "./commands/novelai";
import impersonate from "../en-US/commands/impersonate";
import conditioning from "../en-US/commands/conditioning";
import reward from "../en-US/commands/reward";
import punish from "../en-US/commands/punish";
import support from "../en-US/commands/support";
import contribute from "../en-US/commands/contribute";
import donate from "../en-US/commands/donate";
import nsfw from "../en-US/commands/nsfw";
import openrouter from "../en-US/commands/openrouter";
import config from "./commands/config";
import optionalKey from "../en-US/commands/optional-key";
import server from "./commands/server";
import personal from "./commands/personal";
import scheduledTask from "../en-US/commands/scheduled-task";
import memory from "../en-US/commands/memory";
import teach from "../en-US/commands/teach";
import forget from "../en-US/commands/forget";
import generate from "./commands/generate";
import model from "../en-US/commands/model";
import mcps from "../en-US/commands/mcps";
import capabilities from "../en-US/commands/capabilities";
import provider from "../en-US/commands/provider";
import update from "../en-US/commands/update";
import stats from "./commands/stats";
import ping from "../en-US/commands/ping";
import comment from "../en-US/commands/comment";
import kill from "../en-US/commands/kill";
import refresh from "../en-US/commands/refresh";
import expressions from "../en-US/commands/expressions";
import matrix from "../en-US/commands/matrix";
import respond from "../en-US/commands/respond";
import shared from "../en-US/commands/shared";
import nuke from "../en-US/commands/nuke";
import setup from "./commands/setup";
import compact from "./commands/compact";
import moderation from "./commands/moderation";
import quota from "../en-US/commands/quota";
import providers from "./commands/providers";
import memories from "./commands/memories";
import reset from "../en-US/commands/reset";
import transfer from "./commands/transfer";
import exportCommands from "../en-US/commands/export";
import importCommands from "../en-US/commands/import";

export default {
  commands: {
    ...reset,
    ...transfer,
    ...exportCommands,
    ...importCommands,
    ...memories,
    ...providers,
    ...quota,
    ...moderation,
    ...learn,
    ...choices,
    ...stPreset,
    ...stPresets,
    ...tool,
    ...status,
    ...data,
    ...persona,
    ...help,
    ...legal,
    ...novelai,
    ...impersonate,
    ...conditioning,
    ...reward,
    ...punish,
    ...support,
    ...contribute,
    ...donate,
    ...nsfw,
    ...openrouter,
    ...config,
    ...optionalKey,
    ...server,
    ...personal,
    ...scheduledTask,
    ...memory,
    ...teach,
    ...forget,
    ...generate,
    ...model,
    ...mcps,
    ...capabilities,
    ...provider,
    ...update,
    ...stats,
    ...ping,
    ...comment,
    ...kill,
    ...refresh,
    ...expressions,
    ...matrix,
    ...respond,
    ...shared,
    ...nuke,
    ...setup,
    ...compact,
  },
};
