import { afterEach, describe, expect, it } from "bun:test";
import {
  clearNegativeChatProxyMessageIdentityCacheForTests,
  forgetNegativeChatProxyMessageIdentity,
  hasNegativeChatProxyMessageIdentity,
  rememberNegativeChatProxyMessageIdentity,
} from "@/utils/chatProxy/messageIdentityNegativeCache";

afterEach(clearNegativeChatProxyMessageIdentityCacheForTests);

describe("chat-proxy message identity negative cache", () => {
  it("forgets a miss after successful persistence makes attribution available", () => {
    rememberNegativeChatProxyMessageIdentity("message-1");
    expect(hasNegativeChatProxyMessageIdentity("message-1")).toBe(true);

    forgetNegativeChatProxyMessageIdentity("message-1");
    expect(hasNegativeChatProxyMessageIdentity("message-1")).toBe(false);
  });

  it("evicts the oldest miss instead of growing without a bound", () => {
    for (let index = 0; index <= 2000; index += 1) {
      rememberNegativeChatProxyMessageIdentity(`message-${index}`);
    }

    expect(hasNegativeChatProxyMessageIdentity("message-0")).toBe(false);
    expect(hasNegativeChatProxyMessageIdentity("message-1")).toBe(true);
    expect(hasNegativeChatProxyMessageIdentity("message-2000")).toBe(true);
  });
});
