import { describe, expect, it } from "bun:test";
import {
  analyzePlaceholderParity,
  checkKeyPlaceholderParity,
  extractPlaceholders,
} from "../../../scripts/checks/checkLocalePlaceholders";

describe("locale placeholder parity check", () => {
  it("extracts placeholders properly", () => {
    expect(extractPlaceholders("Hello {name}, welcome to {server}!")).toEqual(["name", "server"]);
    expect(extractPlaceholders("No placeholders here")).toEqual([]);
    expect(extractPlaceholders("{user} and {user} again")).toEqual(["user"]);
    expect(extractPlaceholders("Special chars: {count_1}, {user_nickname}")).toEqual(["count_1", "user_nickname"]);
  });

  it("passes when placeholders match exactly regardless of order", () => {
    // English
    const en = "User {user} in {channel}";

    // Portuguese (Latin)
    const pt = "Usuário {user} no {channel}";
    expect(checkKeyPlaceholderParity("test.key", en, pt, "pt-BR")).toBeNull();

    // Japanese (CJK) - reverse order in natural translation
    const ja = "{channel} でユーザー {user}";
    expect(checkKeyPlaceholderParity("test.key", en, ja, "ja")).toBeNull();

    // Russian (Cyrillic)
    const ru = "Пользователь {user} в канале {channel}";
    expect(checkKeyPlaceholderParity("test.key", en, ru, "ru")).toBeNull();

    // Korean (Hangul)
    const ko = "{channel} 채널의 {user} 사용자";
    expect(checkKeyPlaceholderParity("test.key", en, ko, "ko")).toBeNull();

    // Vietnamese (Latin with diacritics)
    const vi = "Người dùng {user} trong kênh {channel}";
    expect(checkKeyPlaceholderParity("test.key", en, vi, "vi")).toBeNull();
  });

  it("flags missing English placeholders as fatal errors", () => {
    const en = "Saved {count} items for {user}";
    const missingBoth = "Salvo com sucesso!";
    const result1 = checkKeyPlaceholderParity("test.key", en, missingBoth, "pt-BR");
    expect(result1).not.toBeNull();
    expect(result1?.missingInTarget).toEqual(["count", "user"]);
    expect(result1?.extraInTarget).toEqual([]);

    const missingOne = "Usuário {user} atualizado";
    const result2 = checkKeyPlaceholderParity("test.key", en, missingOne, "pt-BR");
    expect(result2).not.toBeNull();
    expect(result2?.missingInTarget).toEqual(["count"]);
    expect(result2?.extraInTarget).toEqual([]);
  });

  it("flags renamed placeholders as both missing error and extra warning", () => {
    const en = "Current model: {model}";
    const esRenamed = "Modelo actual: {modelo}";
    const result = checkKeyPlaceholderParity("test.key", en, esRenamed, "es-419");
    expect(result).not.toBeNull();
    // {model} missing from translation -> error
    expect(result?.missingInTarget).toEqual(["model"]);
    // {modelo} extra in translation -> warning
    expect(result?.extraInTarget).toEqual(["modelo"]);
  });

  it("flags extra placeholders as warnings only without missing errors", () => {
    const en = "Task updated successfully";
    const jaWithId = "タスク {reminder_id} を更新しました";
    const result = checkKeyPlaceholderParity("reminders.task_updated_description", en, jaWithId, "ja");
    expect(result).not.toBeNull();
    expect(result?.missingInTarget).toEqual([]);
    expect(result?.extraInTarget).toEqual(["reminder_id"]);
  });

  it("rejects en-US as target translation and errors on unauthored locales", async () => {
    expect(analyzePlaceholderParity("en-US")).rejects.toThrow("source template");
    expect(analyzePlaceholderParity("fr")).rejects.toThrow("does not exist");
  });
});
