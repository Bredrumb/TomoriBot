import { afterEach, expect, it, spyOn } from "bun:test";
import { setGuildBotAvatar, setGuildBotNickname } from "@/utils/discord/guildIdentity";
import { log } from "@/utils/misc/logger";

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
  spyOn(log, "error").mockRestore();
  spyOn(log, "warn").mockRestore();
  spyOn(log, "metric").mockRestore();
});

it("logs Discord status, code, and invalid fields without the avatar payload", async () => {
  const avatar = "data:image/png;base64,secret-avatar-bytes";
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 50035,
        message: "Invalid Form Body",
        errors: { avatar: { _errors: [{ code: "BASE_TYPE_BAD_LENGTH", message: "Too long" }] } },
      }),
      { status: 400 },
    ),
  );
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});

  const result = await setGuildBotAvatar("123", avatar);

  expect(result.success).toBe(false);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy).toHaveBeenCalledTimes(1);
  const line = JSON.stringify(errorSpy.mock.calls[0]);
  expect(line).toContain("400");
  expect(line).toContain("50035");
  expect(line).toContain("avatar");
  expect(line).not.toContain("secret-avatar-bytes");
});

it("records a metric and warn instead of an error on a 403 nickname permission refusal", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ code: 50013, message: "Missing Permissions" }), {
      status: 403,
      statusText: "Forbidden",
    }),
  );
  const errorSpy = spyOn(log, "error").mockImplementation(async () => {});
  const warnSpy = spyOn(log, "warn").mockImplementation(() => {});
  const metricSpy = spyOn(log, "metric").mockImplementation(() => {});

  const result = await setGuildBotNickname("123", "Tomori");

  expect(result).toEqual({ success: false, error: "api_error", details: "403 Forbidden" });
  expect(errorSpy).toHaveBeenCalledTimes(0);
  expect(warnSpy).toHaveBeenCalledTimes(1);
  expect(metricSpy).toHaveBeenCalledTimes(1);
});
