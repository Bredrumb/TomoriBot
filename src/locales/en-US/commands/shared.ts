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
  },
};
