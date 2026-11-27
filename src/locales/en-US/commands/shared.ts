export default {
  shared: {
    character_reference: {
      invalid_image_title: `Invalid Image`,
      invalid_image_description: `Please upload an image attachment for the character reference.`,
      download_failed_title: `Download Failed`,
      download_failed_description: `Failed to download the selected image attachment. Please try again.`,
      conversion_failed_title: `Image Conversion Failed`,
      conversion_failed_description: `I couldn't convert that image to PNG for storage. Please try a different image.`,
      success_title: `Character Reference Updated`,
      success_me_description: `Updated your character reference image.`,
      success_persona_description: `Updated the character reference image for **{persona_name}**.`,
      cleared_title: `Character Reference Cleared`,
      cleared_me_description: `Cleared your character reference image.`,
      cleared_persona_description: `Cleared the character reference image for **{persona_name}**.`,
    },
    rag: {
      disabled_title: `Document RAG Disabled`,
      disabled_description: `Document retrieval requires the [pgvector](https://github.com/pgvector/pgvector) PostgreSQL extension in your database. Install pgvector and restart me to enable it (see the [self-hosting setup guide](https://docs.tomoribot.app/en/self-hosting/manual-setup/)).`,
    },
    persona_select: {
      main_persona_description: `Main Persona`,
      alter_persona_description: `Alter Persona`,
    },
    send_blocked: {
      cannot_send_title: `I Can't Send Messages Here`,
      cannot_send_description: `I need **View Channel** and **Send Messages** in this channel (or **Send Messages in Threads** in a thread) to reply to chat here, and at least one is missing. Ask a server manager to grant both.`,
      missing_permissions_description: `I couldn't read my own permissions in this channel, so I'm not replying to chat here. Try again in a moment, and if this keeps happening, check my role's permissions.`,
      timed_out_title: `I'm Timed Out`,
      timed_out_description: `A moderator timed me out in this server, so Discord blocks my messages until {time}. Remove the timeout from my member profile if you want me to reply sooner.`,
      send_refused_title: `Discord Refused My Last Message`,
      send_refused_description: `Discord rejected my last message in this channel, usually because a permission changed or I was timed out. I'll try this channel again {time}.`,
    },
  },
};
