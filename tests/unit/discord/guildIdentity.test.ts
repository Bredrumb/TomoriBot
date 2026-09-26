import { afterEach, expect, it, spyOn } from "bun:test";
import { setGuildBotAvatar } from "@/utils/discord/guildIdentity";
import { log } from "@/utils/misc/logger";

afterEach(() => {
  spyOn(globalThis, "fetch").mockRestore();
  spyOn(log, "error").mockRestore();
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
