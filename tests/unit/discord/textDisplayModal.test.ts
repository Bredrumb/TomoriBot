import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { MessageFlags, type ButtonInteraction, type Message, type ModalBuilder } from "discord.js";
import * as userCache from "@/utils/cache/userCache";
import {
  attachTextDisplayModalCollector,
  buildTextDisplayModal,
  buildTextDisplayModalButton,
} from "@/utils/discord/textDisplayModal";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";

describe("text display modal", () => {
  afterEach(() => {
    mock.restore();
  });

  it("preserves text exactly in one large display component", () => {
    const content = "First line\n\n- [Policy](https://example.com/policy)";
    const modal = buildTextDisplayModal({ customId: "legal_text", title: "Privacy Policy", content }).toJSON();

    expect(modal.title).toBe("Privacy Policy");
    expect(modal.components).toHaveLength(1);
    expect(modal.components[0]).toMatchObject({ type: 10, content });
  });

  it("splits long copy without dropping or changing characters", () => {
    const content = "a".repeat(4_001);
    const modal = buildTextDisplayModal({ customId: "long_text", title: "Long text", content }).toJSON();
    const reconstructed = modal.components
      .map((component) => ("content" in component ? component.content : ""))
      .join("");

    expect(modal.components).toHaveLength(2);
    expect(reconstructed).toBe(content);
  });

  it("builds a simple secondary trigger button", () => {
    const row = buildTextDisplayModalButton("tips", "What You Can Do").toJSON();

    expect(row.components[0]).toMatchObject({
      custom_id: "tips",
      label: "What You Can Do",
      style: 2,
      type: 2,
    });
  });

  it("answers a viewer the access gate rejects with an ephemeral notice instead of the modal", async () => {
    await initializeLocalizer();
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(null);
    const collect = attachCollector({ canOpen: () => false, deniedKey: "genai.error_detail.manage_server_only" });
    const reply = mock(async (_payload: unknown) => undefined);
    const showModal = mock(async () => undefined);

    await collect({ locale: "en-US", user: { id: "viewer-1" }, reply, showModal } as unknown as ButtonInteraction);

    expect(showModal).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]?.[0]).toEqual({
      content: localizedCopy("en-US", "genai.error_detail.manage_server_only"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it("renders the modal in the presser's saved language rather than their Discord language", async () => {
    spyOn(userCache, "getCachedUserRow").mockResolvedValue(createUserRow({ language_pref: "en-US" }));
    const collect = attachCollector();
    const showModal = mock(async (_modal: ModalBuilder) => undefined);

    await collect({ locale: "ja", user: { id: "viewer-1" }, showModal } as unknown as ButtonInteraction);

    expect(showModal.mock.calls[0]?.[0].toJSON().title).toBe("en-US");
  });
});

/** Attaches a collector whose modal title is the locale it was rendered in, and returns its click handler. */
function attachCollector(
  access?: Parameters<typeof attachTextDisplayModalCollector>[0]["access"],
): (interaction: ButtonInteraction) => Promise<void> {
  let collect: ((interaction: ButtonInteraction) => Promise<void>) | undefined;
  const message = {
    createMessageComponentCollector: () => ({
      on(event: string, listener: (interaction: ButtonInteraction) => Promise<void>) {
        if (event === "collect") collect = listener;
      },
    }),
  } as unknown as Message;
  attachTextDisplayModalCollector({
    message,
    customId: "detail",
    render: (locale) => ({ title: locale, content: "raw" }),
    timeoutMs: 1_000,
    logLabel: "Detail",
    access,
  });
  if (!collect) throw new Error("Collector did not register a collect listener");
  return collect;
}
