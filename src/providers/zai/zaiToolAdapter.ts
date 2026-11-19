import { OpenAICompatibleToolAdapter } from "@/providers/openaiCompatible/openaiCompatibleToolAdapter";

export class ZaiToolAdapter extends OpenAICompatibleToolAdapter {
  private static instance: ZaiToolAdapter;

  private constructor() {
    super("zai");
  }

  static getInstance(): ZaiToolAdapter {
    if (!ZaiToolAdapter.instance) {
      ZaiToolAdapter.instance = new ZaiToolAdapter();
    }
    return ZaiToolAdapter.instance;
  }
}

export function getZaiToolAdapter(): ZaiToolAdapter {
  return ZaiToolAdapter.getInstance();
}
