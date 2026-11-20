import { beforeAll, describe, expect, it } from "bun:test";
import { initializeLocalizer } from "@/utils/text/localizer";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type ActionRowData,
  type ButtonComponentData,
  type StringSelectMenuComponentData,
  type TextDisplayComponentData,
} from "discord.js";
import type { VoiceSampleRow } from "@/types/db/schema";
import { parseConfigPanelRoute, type ConfigPanelRoute } from "@/utils/discord/configPanelCatalog";
import { parseInteractionRoute, type ParsedInteractionRoute } from "@/utils/discord/interactions/routeRegistry";
import { buildConfigModelsBody } from "@/utils/discord/ui/configModelsPanel";
import {
  buildConfigVoicesBody,
  CONFIG_VOICE_SAMPLE_ADD_VALUE,
  CONFIG_VOICE_SAMPLE_PAGE_SIZE,
  computeVoiceSampleFingerprint,
  decodeVoiceSampleOptionValue,
  encodeVoiceSampleOptionValue,
  voiceSampleAttachmentName,
  type ConfigVoicesView,
} from "@/utils/discord/ui/configVoicesPanel";
import { buildPanelContainer } from "@/utils/discord/ui/panel";
import { validateComponentsV2MessageLimits } from "@/utils/discord/ui/componentsV2Limits";
import { getDiscordTextLength } from "@/utils/text/discordTextLimits";
import { localizedCopy } from "../../helpers/localeCases";

function makeSample(index: number, overrides: Partial<VoiceSampleRow> = {}): VoiceSampleRow {
  return {
    sample_id: index + 1,
    server_id: 100,
    name: `Voice Sample ${index + 1}`,
    file_path: `/data/voices/sample_${index + 1}.wav`,
    ref_text: `Reference transcript text for sample ${index + 1}.`,
    duration_ms: 3500,
    ...overrides,
  };
}

function requireRoute(customId: string): ParsedInteractionRoute {
  const parsed = parseInteractionRoute(customId);
  if (!parsed) throw new Error(`Failed to parse route for customId: ${customId}`);
  return parsed;
}

function buttonCustomId(button: ButtonComponentData): string {
  return "customId" in button ? button.customId : "";
}

describe("configVoicesPanel", () => {
  beforeAll(async () => initializeLocalizer());
  it("renders non-empty body with all components in exact order through buildConfigModelsBody", () => {
    const samples = Array.from({ length: CONFIG_VOICE_SAMPLE_PAGE_SIZE }, (_, i) => makeSample(i));
    const view: ConfigVoicesView = {
      turboEnabled: false,
      cfgWeight: 0.5,
      exaggeration: 0.5,
      samples,
      totalSampleCount: CONFIG_VOICE_SAMPLE_PAGE_SIZE * 2,
      start: 0,
      selectedIndex: 0,
    };

    const components = buildConfigModelsBody({
      locale: "en-US",
      page: "voices",
      readStatus: "fresh",
      voicesView: view,
    });

    expect(components.length).toBe(8);

    expect(components[0].type).toBe(ComponentType.TextDisplay);
    const headingText = (components[0] as TextDisplayComponentData).content;
    expect(headingText).toContain(localizedCopy("en-US", "commands.config.panel.voices.page.title"));

    expect(components[1].type).toBe(ComponentType.TextDisplay);
    const paramsText = (components[1] as TextDisplayComponentData).content;
    expect(paramsText).toContain(localizedCopy("en-US", "commands.config.panel.voices.page.parameters_title"));
    expect(paramsText).toContain(localizedCopy("en-US", "commands.config.panel.voices.parameters.standard_notice"));

    expect(components[2].type).toBe(ComponentType.ActionRow);
    const editParamsRow = components[2] as ActionRowData<ButtonComponentData>;
    expect(editParamsRow.components.length).toBe(1);
    const editParamsRoute = parseConfigPanelRoute(requireRoute(buttonCustomId(editParamsRow.components[0])));
    expect(editParamsRoute?.action).toBe("tts-parameters-open");

    expect(components[3].type).toBe(ComponentType.TextDisplay);
    const libraryHeader = (components[3] as TextDisplayComponentData).content;
    expect(libraryHeader).toContain(localizedCopy("en-US", "commands.config.panel.voices.page.library_header"));

    expect(components[4].type).toBe(ComponentType.ActionRow);
    const selectRow = components[4] as ActionRowData<StringSelectMenuComponentData>;
    expect(selectRow.components[0].type).toBe(ComponentType.StringSelect);
    const selectRoute = parseConfigPanelRoute(requireRoute(selectRow.components[0].customId ?? ""));
    expect(selectRoute?.action).toBe("voice-sample-select");
    expect(selectRow.components[0].options.length).toBe(CONFIG_VOICE_SAMPLE_PAGE_SIZE + 1);
    expect(selectRow.components[0].options[0]?.value).toBe(CONFIG_VOICE_SAMPLE_ADD_VALUE);
    expect(selectRow.components[0].options[1]).toMatchObject({ label: "Voice Sample 1", default: true });

    expect(components[5].type).toBe(ComponentType.TextDisplay);
    const libraryText = (components[5] as TextDisplayComponentData).content;
    expect(libraryText).not.toContain("Voice Sample 1");

    expect(components[6].type).toBe(ComponentType.ActionRow);
    const paginationRow = components[6] as ActionRowData<ButtonComponentData>;
    expect(paginationRow.components.length).toBe(3);
    const nextRoute = parseConfigPanelRoute(requireRoute(buttonCustomId(paginationRow.components[2])));
    expect(nextRoute?.action).toBe("voice-sample-page");

    expect(components[7].type).toBe(ComponentType.ActionRow);
    const actionRow = components[7] as ActionRowData<ButtonComponentData>;
    expect(actionRow.components.length).toBe(1);
    const removeRoute = parseConfigPanelRoute(requireRoute(buttonCustomId(actionRow.components[0])));
    expect(removeRoute?.action).toBe("voice-sample-remove-view");
    expect(actionRow.components[0].disabled).toBe(false);
  });

  it("keeps turbo controls in the parameter summary and uses the edit button for changes", () => {
    const viewTurboOn: ConfigVoicesView = {
      turboEnabled: true,
      cfgWeight: 0.7,
      exaggeration: 0.8,
      samples: [],
      totalSampleCount: 0,
      start: 0,
      selectedIndex: null,
    };
    const body = buildConfigVoicesBody({ locale: "en-US", readStatus: "fresh", view: viewTurboOn });
    const paramsText = body[1] as TextDisplayComponentData;
    expect(paramsText.content).toContain("Chatterbox fast model: Enabled");
  });

  it("renders only the selected sample and its File component", () => {
    const samples = [makeSample(0, { duration_ms: 10100 }), makeSample(1, { name: "Other Sample" })];
    const view: ConfigVoicesView = {
      turboEnabled: false,
      cfgWeight: 0.5,
      exaggeration: 0.5,
      samples,
      totalSampleCount: samples.length,
      start: 0,
      selectedIndex: 0,
      preview: {
        sampleId: samples[0].sample_id as number,
        fingerprint: computeVoiceSampleFingerprint(samples[0]),
        attachmentName: voiceSampleAttachmentName(samples[0].sample_id as number),
        buffer: Buffer.from("RIFF-preview"),
        unavailable: false,
      },
    };

    const components = buildConfigVoicesBody({ locale: "en-US", readStatus: "fresh", view });
    const libraryHeader = components.find(
      (component) =>
        component.type === ComponentType.TextDisplay &&
        (component as TextDisplayComponentData).content.includes("Voice Sample Library"),
    ) as TextDisplayComponentData;
    const libraryText = components.find(
      (component) =>
        component.type === ComponentType.TextDisplay &&
        (component as TextDisplayComponentData).content.includes("> 10.1s duration"),
    ) as TextDisplayComponentData;

    expect(libraryHeader.content).toContain(localizedCopy("en-US", "commands.config.panel.voices.page.library_header"));
    expect(libraryText.content).toContain("> 10.1s duration");
    expect(libraryText.content).toContain("> *Reference transcript text for sample 1.*");
    expect(libraryText.content).not.toContain("Voice Sample 1");
    expect(libraryText.content).not.toContain("Other Sample");

    const selectRow = components.find(
      (component) =>
        component.type === ComponentType.ActionRow &&
        (component as ActionRowData<StringSelectMenuComponentData>).components[0]?.type === ComponentType.StringSelect,
    ) as ActionRowData<StringSelectMenuComponentData>;
    expect(selectRow.components[0]?.options[1]).toMatchObject({ label: "Voice Sample 1", default: true });

    const file = components.find((component) => component.type === ComponentType.File) as {
      type: ComponentType.File;
      file: { url: string };
    };
    expect(file.type).toBe(ComponentType.File);
    expect(file.file.url).toBe(`attachment://${voiceSampleAttachmentName(1)}`);
    expect(components.indexOf(selectRow)).toBeGreaterThan(components.indexOf(libraryHeader));
    expect(components.indexOf(file)).toBeGreaterThan(components.indexOf(libraryText));
  });

  it("keeps selected metadata when the audio preview is unavailable", () => {
    const sample = makeSample(0, { duration_ms: 10100 });
    const components = buildConfigVoicesBody({
      locale: "en-US",
      readStatus: "fresh",
      view: {
        turboEnabled: false,
        cfgWeight: 0.5,
        exaggeration: 0.5,
        samples: [sample],
        totalSampleCount: 1,
        start: 0,
        selectedIndex: 0,
        preview: {
          sampleId: sample.sample_id as number,
          fingerprint: computeVoiceSampleFingerprint(sample),
          attachmentName: voiceSampleAttachmentName(sample.sample_id as number),
          unavailable: true,
        },
      },
    });

    const text = components
      .filter((component) => component.type === ComponentType.TextDisplay)
      .map((component) => (component as TextDisplayComponentData).content)
      .join("\n");
    const selectRow = components.find(
      (component) =>
        component.type === ComponentType.ActionRow &&
        (component as ActionRowData<StringSelectMenuComponentData>).components[0]?.type === ComponentType.StringSelect,
    ) as ActionRowData<StringSelectMenuComponentData>;
    expect(selectRow.components[0]?.options[1]).toMatchObject({ label: "Voice Sample 1", default: true });
    expect(text).not.toContain("Voice Sample 1");
    expect(text).toContain(localizedCopy("en-US", "commands.config.panel.voices.page.audio_preview_unavailable"));
    expect(components.some((component) => component.type === ComponentType.File)).toBe(false);
  });

  it("every select option value round-trips to index and fingerprint, and index 0 survives", () => {
    const samples = [
      makeSample(0, { name: "First Sample" }),
      makeSample(1, { name: "Second Sample" }),
      makeSample(2, { name: "Third Sample" }),
    ];
    const view: ConfigVoicesView = {
      turboEnabled: false,
      cfgWeight: 0.5,
      exaggeration: 0.5,
      samples,
      totalSampleCount: 3,
      start: 0,
      selectedIndex: 0,
    };

    const components = buildConfigVoicesBody({
      locale: "en-US",
      readStatus: "fresh",
      view,
    });

    const selectRow = components.find(
      (c) =>
        c.type === ComponentType.ActionRow &&
        (c as ActionRowData<ButtonComponentData | StringSelectMenuComponentData>).components[0]?.type ===
          ComponentType.StringSelect,
    ) as ActionRowData<StringSelectMenuComponentData>;

    expect(selectRow).toBeDefined();
    const [addOption, ...sampleOptions] = selectRow.components[0].options;
    expect(addOption?.value).toBe(CONFIG_VOICE_SAMPLE_ADD_VALUE);
    expect(sampleOptions.length).toBe(3);

    for (let i = 0; i < sampleOptions.length; i++) {
      const option = sampleOptions[i];
      const decoded = decodeVoiceSampleOptionValue(option.value);
      if (!decoded) throw new Error(`Failed to decode voice sample option value: ${option.value}`);
      expect(decoded.index).toBe(i);
      expect(decoded.fp).toBe(computeVoiceSampleFingerprint(samples[i]));

      const routeId = `config:v2:vsample-rem-view:en-US:${option.value}`;
      const parsed = parseConfigPanelRoute(requireRoute(routeId));
      expect(parsed).not.toBeNull();
      expect((parsed as Extract<ConfigPanelRoute, { action: "voice-sample-remove-view" }>).index).toBe(i);
      expect((parsed as Extract<ConfigPanelRoute, { action: "voice-sample-remove-view" }>).fp).toBe(decoded.fp);
    }

    const zeroVal = encodeVoiceSampleOptionValue(0, "abcd1234");
    const zeroDecoded = decodeVoiceSampleOptionValue(zeroVal);
    expect(zeroDecoded).not.toBeNull();
    expect(zeroDecoded?.index).toBe(0);
    expect(zeroDecoded?.fp).toBe("abcd1234");
  });

  it("pagination union covers every record across multiple pages with no gaps or duplicates", () => {
    const pageSize = CONFIG_VOICE_SAMPLE_PAGE_SIZE;
    const totalCount = pageSize * 2 + 18;
    const allSamples = Array.from({ length: totalCount }, (_, i) => makeSample(i));
    const pageCount = Math.ceil(totalCount / pageSize);

    const visitedIndices = new Set<number>();
    const seenSampleNames: string[] = [];

    for (let page = 0; page < pageCount; page++) {
      const start = page * pageSize;
      const pageSlice = allSamples.slice(start, start + pageSize);

      const view: ConfigVoicesView = {
        turboEnabled: false,
        cfgWeight: 0.5,
        exaggeration: 0.5,
        samples: pageSlice,
        totalSampleCount: totalCount,
        start,
        selectedIndex: null,
      };

      const components = buildConfigVoicesBody({
        locale: "en-US",
        readStatus: "fresh",
        view,
      });

      const selectRow = components.find(
        (c) =>
          c.type === ComponentType.ActionRow &&
          (c as ActionRowData<ButtonComponentData | StringSelectMenuComponentData>).components[0]?.type ===
            ComponentType.StringSelect,
      ) as ActionRowData<StringSelectMenuComponentData>;

      expect(selectRow).toBeDefined();
      const [addOption, ...sampleOptions] = selectRow.components[0].options;
      expect(addOption?.value).toBe(CONFIG_VOICE_SAMPLE_ADD_VALUE);
      expect(sampleOptions.length).toBe(pageSlice.length);

      for (let offset = 0; offset < sampleOptions.length; offset++) {
        const option = sampleOptions[offset];
        const decoded = decodeVoiceSampleOptionValue(option.value);
        expect(decoded).not.toBeNull();
        const expectedIndex = start + offset;
        expect(decoded?.index).toBe(expectedIndex);

        if (decoded?.index !== undefined) {
          expect(visitedIndices.has(decoded.index)).toBe(false);
          visitedIndices.add(decoded.index);
        }
        seenSampleNames.push(option.label);
      }
    }

    expect(visitedIndices.size).toBe(totalCount);
    for (let i = 0; i < totalCount; i++) {
      expect(visitedIndices.has(i)).toBe(true);
    }
  });

  it("handles extreme content shapes without fence breakout, overflow, or crashing", () => {
    const extremeSamples: VoiceSampleRow[] = [
      makeSample(0, {
        name: "A".repeat(64),
        ref_text: "B".repeat(500),
      }),
      makeSample(1, {
        name: "OversizedName_".repeat(10),
        ref_text: "Standard transcript.",
      }),
      makeSample(2, {
        name: "Backtick```Three",
        ref_text: "Prefix ``` inner code fence ``` suffix",
      }),
      makeSample(3, {
        name: "Backtick````Four",
        ref_text: "Quad ```` backticks ```` test",
      }),
      makeSample(4, {
        name: "Backtick`````Five",
        ref_text: "Five ````` backtick run ````` here",
      }),
      makeSample(5, {
        name: "Backtick``````Six",
        ref_text: "Six `````` backticks `````` test",
      }),
      makeSample(6, {
        name: "Backtick````````Eight",
        ref_text: "Eight ```````` backticks ```````` test",
      }),
      makeSample(7, {
        name: "Voice 🪅 🚀 👨‍👩‍👧‍👦 🏳️‍🌈",
        ref_text: "Emoji transcript with 🎭 🎤 🎧 and surrogate pairs 𠮷野家",
      }),
    ];

    while (extremeSamples.length < CONFIG_VOICE_SAMPLE_PAGE_SIZE) {
      const idx = extremeSamples.length;
      extremeSamples.push(
        makeSample(idx, {
          name: `Sample ${idx} with ${"```".repeat(2)} and 🚀`,
          ref_text: `${"Transcript ".repeat(30)}\`\`\``,
        }),
      );
    }

    const view: ConfigVoicesView = {
      turboEnabled: false,
      cfgWeight: 0.5,
      exaggeration: 0.5,
      samples: extremeSamples,
      totalSampleCount: 100,
      start: 0,
      selectedIndex: 2,
    };

    const components = buildConfigVoicesBody({
      locale: "en-US",
      readStatus: "fresh",
      view,
    });

    for (const comp of components) {
      if (comp.type === ComponentType.TextDisplay) {
        const textComp = comp as TextDisplayComponentData;
        const length = getDiscordTextLength(textComp.content);
        expect(length).toBeLessThanOrEqual(4000);
      }
    }

    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [buildPanelContainer(components)],
    };
    const validation = validateComponentsV2MessageLimits(payload);
    expect(validation.valid).toBe(true);
    expect(validation.violations).toEqual([]);
  });

  it("renders confirm pair and removes library controls when removeConfirm is set", () => {
    const samples = [makeSample(0), makeSample(1), makeSample(2)];
    const view: ConfigVoicesView = {
      turboEnabled: false,
      cfgWeight: 0.5,
      exaggeration: 0.5,
      samples,
      totalSampleCount: 3,
      start: 0,
      selectedIndex: 1,
      removeConfirm: {
        index: 1,
        fp: "abcd1234",
        refCount: 3,
        nonce: "nonce1234567",
      },
    };

    const components = buildConfigVoicesBody({
      locale: "en-US",
      readStatus: "fresh",
      view,
    });

    expect(components.length).toBe(5);

    const confirmTextComp = components[3] as TextDisplayComponentData;
    expect(confirmTextComp.type).toBe(ComponentType.TextDisplay);
    expect(confirmTextComp.content).toContain(
      localizedCopy("en-US", "commands.config.panel.voices.page.confirm_title"),
    );
    expect(confirmTextComp.content).toContain("3 persona(s)");

    const confirmRow = components[4] as ActionRowData<ButtonComponentData>;
    expect(confirmRow.type).toBe(ComponentType.ActionRow);
    expect(confirmRow.components.length).toBe(2);

    const [confBtn, cancelBtn] = confirmRow.components;
    expect(confBtn.style).toBe(ButtonStyle.Danger);
    const confRoute = parseConfigPanelRoute(requireRoute(buttonCustomId(confBtn)));
    expect(confRoute?.action).toBe("voice-sample-remove-confirm");
    expect((confRoute as Extract<ConfigPanelRoute, { action: "voice-sample-remove-confirm" }>).index).toBe(1);
    expect((confRoute as Extract<ConfigPanelRoute, { action: "voice-sample-remove-confirm" }>).fp).toBe("abcd1234");
    expect((confRoute as Extract<ConfigPanelRoute, { action: "voice-sample-remove-confirm" }>).nonce).toBe(
      "nonce1234567",
    );

    expect(cancelBtn.style).toBe(ButtonStyle.Secondary);
    const cancelRoute = parseConfigPanelRoute(requireRoute(buttonCustomId(cancelBtn)));
    expect(cancelRoute?.action).toBe("voice-sample-remove-cancel");

    const hasSelect = components.some(
      (c) =>
        c.type === ComponentType.ActionRow &&
        (c as ActionRowData<ButtonComponentData | StringSelectMenuComponentData>).components[0]?.type ===
          ComponentType.StringSelect,
    );
    expect(hasSelect).toBe(false);
  });
});
