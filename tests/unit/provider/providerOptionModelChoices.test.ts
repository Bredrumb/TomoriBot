import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { localizedCopy } from "../../helpers/localeCases";
import { buildModelSelectOption } from "@/utils/discord/ui/modelSelectOption";
import {
  describeProviderOptionModelChoices,
  registerProviderOption,
  type ProviderOptionDefinition,
  type ProviderOptionModelChoicesInput,
} from "@/utils/provider/providerOptionRegistry";
import { initializeLocalizer } from "@/utils/text/localizer";

beforeAll(async () => initializeLocalizer());

const OPTION_VALUE = "test-priced-option";
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function registerPricedOption(): ProviderOptionModelChoicesInput[] {
  const calls: ProviderOptionModelChoicesInput[] = [];
  const option: ProviderOptionDefinition = {
    value: OPTION_VALUE,
    catalogProvider: "openrouter",
    capabilities: ["text"],
    copy: {
      labelKey: "commands.providers.entry_kind_provider",
      entryDescriptionKeys: {
        server: "commands.providers.entry_kind_endpoint",
        personal: "commands.providers.entry_kind_brave",
      },
      addActionLabelKey: "commands.providers.select_add_provider",
      addActionDescriptionKeys: {
        server: "commands.providers.select_add_provider_description",
        personal: "commands.providers.select_add_endpoint_description",
      },
      removeImpactKey: "commands.providers.remove_impact_provider",
    },
    availability: () => ({ eligible: true }),
    selection: {
      load: async () => null,
      ensure: async () => true,
      claim: async () => true,
      remove: async () => "removed",
    },
    describeModelChoices: async (input) => {
      calls.push(input);
      return new Map([
        [1, { priceLabel: null, isDefault: true }],
        [2, { priceLabel: "3x baseline", isDefault: false }],
      ]);
    },
  };
  cleanups.push(registerProviderOption(option));
  return calls;
}

const CATALOG = [
  { id: 1, name: "baseline", description: null, pricing: { input: 0.1, output: 0.2 }, isDefault: false },
  { id: 2, name: "pricier", description: null, pricing: { input: 0.3, output: 0.6 }, isDefault: true },
  { id: 3, name: "unlisted", description: null, pricing: { input: 1, output: 2 }, isDefault: false },
];

describe("describeProviderOptionModelChoices", () => {
  it("lets an option replace catalog prices and default markers", async () => {
    const calls = registerPricedOption();
    const [baseline, pricier, unlisted] = await describeProviderOptionModelChoices(OPTION_VALUE, {
      scope: { kind: "server", ownerId: 9 },
      capability: "text",
      locale: "en-US",
      choices: CATALOG,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.choices).toHaveLength(CATALOG.length);

    const baselineOption = buildModelSelectOption("en-US", OPTION_VALUE, baseline, null);
    expect(baselineOption.label).toBe(
      localizedCopy("en-US", "commands.providers.model_default_label", { model: "baseline" }),
    );
    expect(baselineOption.description).toBeUndefined();

    const pricierOption = buildModelSelectOption("en-US", OPTION_VALUE, pricier, null);
    expect(pricierOption.label).toBe("pricier");
    expect(pricierOption.description).toBe("3x baseline");

    const unlistedOption = buildModelSelectOption("en-US", OPTION_VALUE, unlisted, null);
    expect(unlistedOption.description).toBe(
      localizedCopy("en-US", "commands.providers.model_price_tokens", { input: "$1.00", output: "$2.00" }),
    );
  });

  it("leaves choices untouched for providers without the hook", async () => {
    const calls = registerPricedOption();
    const choices = await describeProviderOptionModelChoices("openrouter", {
      scope: { kind: "server", ownerId: 9 },
      capability: "text",
      locale: "en-US",
      choices: CATALOG,
    });
    expect(choices).toBe(CATALOG);
    expect(calls).toHaveLength(0);
  });
});
