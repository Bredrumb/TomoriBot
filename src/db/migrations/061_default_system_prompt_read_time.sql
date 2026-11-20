-- Migration 061: stop freezing servers on a copy of the default system prompt.
--
-- Setup used to INSERT the DEFAULT_SYSTEM_PROMPT constant straight into
-- server_chat_configs.system_prompt. The runtime fallback
-- (`system_prompt?.trim() || DEFAULT_SYSTEM_PROMPT`) therefore never fired for a
-- server that had run setup, so editing the constant reached only servers that had
-- explicitly run `/config system-prompt remove`. Setup no longer seeds the column;
-- this clears the copies already stored so those servers resolve the default at
-- read time like everyone else.
--
-- The three literals below are every value the constant has ever held, recovered
-- from git history. Matching on exact equality is what makes this safe: a server
-- that customized its prompt differs from all three and is left untouched. Any
-- future edit to the constant needs no migration at all, which is the point.

UPDATE server_chat_configs
SET system_prompt = NULL
WHERE system_prompt IN (
  E'\n{bot} makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.',
  E'\n{bot} limits themselves to only 0 to 2 emojis per response ({bot} prefers to use available server emojis than normal emojis) and makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.',
  E'\n{bot} limits themselves to only 0 to 1 emojis per response ({bot} prefers to use available server emojis than normal emojis) and makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.'
);
