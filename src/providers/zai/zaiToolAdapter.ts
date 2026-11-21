import { OpenAICompatibleToolAdapter } from "@/providers/openaiCompatible/openaiCompatibleToolAdapter";

/**
 * Singleton tool adapter for Z.ai provider.
 * Extends the shared OpenAI-compatible adapter with no overrides needed.
 */
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

/**
 * Get the singleton Z.ai tool adapter instance
 */
export function getZaiToolAdapter(): ZaiToolAdapter {
  return ZaiToolAdapter.getInstance();
}
