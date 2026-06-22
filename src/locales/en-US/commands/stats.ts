// locales/en-US/commands/stats.ts

export default {
  stats: {
    description: `View usage statistics`,

    personal: {
      description: `View your own usage statistics.`,
      timeframe_description: `The time window to summarize.`,
      scope_description: `Count activity on this server only, or across all servers.`,
    },
    persona: {
      description: `View a persona's usage statistics on this server.`,
      timeframe_description: `The time window to summarize.`,
      picker_title: `Pick a Persona`,
      picker_description: `Select a persona to view its statistics.`,
      no_personas_title: `No Personas`,
      no_personas_description: `This server has no personas to show statistics for yet.`,
    },
    server: {
      description: `View server-wide usage statistics.`,
      timeframe_description: `The time window to summarize.`,
    },

    // Shared dashboard strings
    empty: `—`,
    footer: `Token and cost figures are rough character-based estimates.`,
    unknown_persona: `Persona #{id}`,
    days: `{count} days`,
    local_suffix: `local`,
    weekday_names: `Sun,Mon,Tue,Wed,Thu,Fri,Sat`,

    tabs: {
      overview_label: `Overview`,
      overview_title: `Overview`,
      personas_label: `Personas`,
      personas_title: `Personas`,
      models_label: `Models`,
      models_title: `Models & Cost`,
      tools_label: `Tools`,
      tools_title: `Tools & Commands`,
      expression_label: `Expression`,
      expression_title: `Expression`,
      people_label: `People`,
      people_title: `Favorite People`,
      leaderboard_label: `Leaderboard`,
      leaderboard_title: `Leaderboard`,
    },

    fields: {
      messages: `Messages`,
      commands: `Commands Run`,
      current_streak: `Current Streak`,
      longest_streak: `Longest Streak`,
      peak_hour: `Most Active Hour`,
      peak_weekday: `Most Active Day`,
      rewards: `Rewards`,
      punishments: `Punishments`,
      favorite_persona: `Favorite Persona (loyalty)`,
      persona_affinity: `Persona Affinity`,
      top_models: `Top Models`,
      model_diversity: `Models Used`,
      tokens_in: `Input Tokens (est.)`,
      tokens_out: `Output Tokens (est.)`,
      est_cost: `Estimated Cost`,
      top_tools: `Top Tools`,
      top_commands: `Top Commands`,
      top_emoji: `Top Emoji`,
      top_stickers: `Top Stickers`,
      top_sprites: `Top Sprites`,
      top_people: `Most Talkative People`,
      leaderboard: `Top Members`,
      images: `Images Generated`,
      videos: `Videos Generated`,
    },
  },
};
