import { OpenAICompatibleToolAdapter } from "@/providers/openaiCompatible/openaiCompatibleToolAdapter";

export class ZaicodingToolAdapter extends OpenAICompatibleToolAdapter {
  private static instance: ZaicodingToolAdapter;

  private constructor() {
    super("zaicoding");
  }

  static getInstance(): ZaicodingToolAdapter {
    if (!ZaicodingToolAdapter.instance) {
      ZaicodingToolAdapter.instance = new ZaicodingToolAdapter();
    }
    return ZaicodingToolAdapter.instance;
  }
}

export function getZaicodingToolAdapter(): ZaicodingToolAdapter {
  return ZaicodingToolAdapter.getInstance();
}
