import { describe, expect, it } from "bun:test";
import {
  buildCapabilityAddModalComponents,
  ModalFieldId,
  parseCapabilityModalFields,
} from "@/utils/provider/customEndpointCapabilityModal";

describe("custom text endpoint VRAM handoff selection", () => {
  it("defaults to no handoff", () => {
    expect(parseCapabilityModalFields({}, {}, "text").handoffStrategy).toBe("none");
  });

  it("reads the selected KoboldCpp or Ollama handoff", () => {
    expect(
      parseCapabilityModalFields({ [ModalFieldId.handoff_strategy]: "koboldcpp" }, {}, "text")
        .handoffStrategy,
    ).toBe("koboldcpp");
    expect(
      parseCapabilityModalFields({ [ModalFieldId.handoff_strategy]: "ollama" }, {}, "text").handoffStrategy,
    ).toBe("ollama");
  });

  it("maps the unsupported other option to no automatic handoff", () => {
    expect(
      parseCapabilityModalFields({ [ModalFieldId.handoff_strategy]: "other" }, {}, "text").handoffStrategy,
    ).toBe("none");
  });

  it("uses a mutually-exclusive radio group with an explicit unsupported option", () => {
    const handoff = buildCapabilityAddModalComponents("text", "en-US").find(
      (component) => component.customId === ModalFieldId.handoff_strategy,
    );
    expect(handoff).toMatchObject({ kind: "radioGroup", required: true });
    expect((handoff as { options: Array<{ value: string }> }).options.map((option) => option.value)).toEqual([
      "none",
      "koboldcpp",
      "ollama",
      "other",
    ]);
  });
});
