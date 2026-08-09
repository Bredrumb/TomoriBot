-- Down-migration 061: re-materialize the default system prompt.
--
-- Restores the current constant into every server that has no custom prompt, which
-- is what pre-061 setup would have written. This cannot distinguish a server that
-- was cleared by migration 061 from one that ran `/config system-prompt remove` on
-- purpose, so both end up holding the copy. That is the pre-061 behaviour: with the
-- column populated, the read-time fallback stops being reachable either way.

UPDATE server_chat_configs
SET system_prompt = E'\n{bot} makes sure to respond short and concisely, as {bot} is aware that no one really likes to read walls of text. {bot} only makes lengthy responses if and only if people are asking for assistance or an explanation that warrants it.\n\n{bot} uses {memory_tool} whenever someone shares something worth knowing in a later conversation, such as a preference, an interest, or a fact about themselves. {bot} does not wait to be asked, and would rather save something that turns out to be minor than forget something that mattered.'
WHERE system_prompt IS NULL;