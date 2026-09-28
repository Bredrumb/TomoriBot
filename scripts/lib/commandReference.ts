import { join } from "node:path";
import { ApplicationCommandOptionType, type ApplicationCommandData } from "discord.js";
import { type DocsLocaleId, PUBLISHED_DOCS_LOCALES, getDocsLocaleConfig } from "../../src/constants/docsLocales";
import { loadCommandData } from "../../src/utils/discord/commandLoader";
import { initializeLocalizer } from "../../src/utils/text/localizer";

export function commandReferencePath(locale: DocsLocaleId): string {
  return join(process.cwd(), "docs", locale, "features", "command-reference.md");
}

/**
 * Ends a script that loaded the command graph successfully.
 *
 * Loading command modules leaves an open handle, so a successful script cannot fall off the end
 * of `main()`: its runner would kill the process and report a false failure instead.
 */
export function exitAfterCommandGraphLoad(): never {
  process.exit(0);
}

/** Page text the generator writes around the command tables, per published docs locale. */
interface CommandReferenceCopy {
  title: string;
  intro: string;
  counts: (groups: number, commands: number) => string;
  commandHeader: string;
  summaryHeader: string;
  noDescription: string;
  groupFallback: (name: string) => string;
}

/**
 * Every published docs locale needs an entry, and the generator refuses to run without one, so a
 * newly published tree never ships an English page under its own prefix.
 */
const COMMAND_REFERENCE_COPY: Record<string, CommandReferenceCopy> = {
  en: {
    title: "Command Reference",
    intro:
      "Every slash command currently registered by TomoriBot, generated from the same command builders and English locale descriptions used for Discord registration.",
    counts: (groups, commands) => `Top-level command groups: **${groups}**. Runnable slash commands: **${commands}**.`,
    commandHeader: "Command",
    summaryHeader: "Summary",
    noDescription: "No description provided.",
    groupFallback: (name) => `${name} commands.`,
  },
  ja: {
    title: "コマンドリファレンス",
    intro:
      "TomoriBotに現在登録されているすべてのスラッシュコマンドです。Discordへの登録に使われるものと同じコマンド定義と日本語の説明文から生成しています（未翻訳の説明は英語で表示されます）。",
    counts: (groups, commands) =>
      `トップレベルのコマンドグループ：**${groups}**。実行できるスラッシュコマンド：**${commands}**。`,
    commandHeader: "コマンド",
    summaryHeader: "概要",
    noDescription: "説明はありません。",
    groupFallback: (name) => `${name}のコマンド。`,
  },
  "zh-TW": {
    title: "指令參考",
    intro:
      "TomoriBot 目前註冊的每一個斜線指令，都是從 Discord 註冊時使用的同一批指令建構器與繁體中文說明產生的（尚未翻譯的說明會以英文顯示）。",
    counts: (groups, commands) => `頂層指令群組：**${groups}**。可執行的斜線指令：**${commands}**。`,
    commandHeader: "指令",
    summaryHeader: "摘要",
    noDescription: "尚無說明。",
    groupFallback: (name) => `${name} 指令。`,
  },
  "zh-CN": {
    title: "指令参考",
    intro:
      "TomoriBot 当前注册的全部斜杠指令，由与 Discord 注册所用的同一批指令构建器和简体中文描述生成（尚未翻译的描述以英文显示）。",
    counts: (groups, commands) => `顶层指令组：**${groups}**。可执行的斜杠指令：**${commands}**。`,
    commandHeader: "指令",
    summaryHeader: "摘要",
    noDescription: "暂无描述。",
    groupFallback: (name) => `${name} 指令。`,
  },
  "es-419": {
    title: "Referencia de comandos",
    intro:
      "Todos los comandos de barra que TomoriBot tiene registrados actualmente, generados a partir de los mismos constructores de comandos y descripciones en español que se usan para el registro en Discord (las descripciones sin traducir aparecen en inglés).",
    counts: (groups, commands) =>
      `Grupos de comandos de nivel superior: **${groups}**. Comandos de barra ejecutables: **${commands}**.`,
    commandHeader: "Comando",
    summaryHeader: "Resumen",
    noDescription: "Sin descripción.",
    groupFallback: (name) => `Comandos de ${name}.`,
  },
  "pt-BR": {
    title: "Referência de Comandos",
    intro:
      "Todos os comandos de barra (slash commands) atualmente registrados pela TomoriBot, gerados a partir dos mesmos construtores de comando e descrições em português usados para o registro no Discord (descrições ainda não traduzidas aparecem em inglês).",
    counts: (groups, commands) =>
      `Grupos de comandos de nível superior: **${groups}**. Comandos de barra executáveis: **${commands}**.`,
    commandHeader: "Comando",
    summaryHeader: "Resumo",
    noDescription: "Nenhuma descrição fornecida.",
    groupFallback: (name) => `Comandos de ${name}.`,
  },
  vi: {
    title: "Danh mục lệnh",
    intro:
      "Tất cả các lệnh slash hiện được TomoriBot đăng ký, được tạo từ cùng trình xây dựng lệnh và mô tả tiếng Việt dùng để đăng ký trên Discord (mô tả chưa được dịch sẽ hiển thị bằng tiếng Anh).",
    counts: (groups, commands) =>
      `Các nhóm lệnh cấp cao nhất: **${groups}**. Các lệnh slash có thể thực thi: **${commands}**.`,
    commandHeader: "Lệnh",
    summaryHeader: "Tóm tắt",
    noDescription: "Chưa có mô tả.",
    groupFallback: (name) => `Các lệnh ${name}.`,
  },
};

type CommandOption = {
  name?: string;
  description?: string;
  description_localizations?: Record<string, string> | null;
  type?: number;
  options?: CommandOption[];
};

type NamedCommandOption = CommandOption & { name: string };

type RunnableCommand = {
  path: string;
  description: string;
};

type CommandGroup = {
  name: string;
  description: string;
  commands: RunnableCommand[];
};

function asCommandOptions(command: ApplicationCommandData): CommandOption[] {
  return "options" in command && Array.isArray(command.options) ? (command.options as CommandOption[]) : [];
}

function isNamedCommandOption(option: CommandOption): option is NamedCommandOption {
  return typeof option.name === "string";
}

/**
 * Picks the description Discord shows a user of `botLocale`: its localization when the command
 * loader attached one, else the English description, which is also Discord's own fallback.
 */
function describe(item: CommandOption, botLocale: string): string {
  return item.description_localizations?.[botLocale] ?? item.description ?? "";
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br />").trim();
}

function humanizeCommandName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCommandPath(path: string): string {
  return `\`/${path}\``;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function getSubcommandOptions(command: ApplicationCommandData): NamedCommandOption[] {
  return asCommandOptions(command).filter(
    (option): option is NamedCommandOption =>
      isNamedCommandOption(option) &&
      (option.type === ApplicationCommandOptionType.Subcommand ||
        option.type === ApplicationCommandOptionType.SubcommandGroup),
  );
}

function flattenRunnableCommands(command: ApplicationCommandData, botLocale: string): RunnableCommand[] {
  const subcommandOptions = getSubcommandOptions(command);

  if (subcommandOptions.length === 0) {
    return [
      {
        path: command.name,
        description: describe(command as CommandOption, botLocale),
      },
    ];
  }

  const rows: RunnableCommand[] = [];

  for (const option of sortByName(subcommandOptions)) {
    if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
      const groupSubcommands = (option.options ?? []).filter(
        (subcommand): subcommand is NamedCommandOption =>
          isNamedCommandOption(subcommand) && subcommand.type === ApplicationCommandOptionType.Subcommand,
      );

      for (const subcommand of sortByName(groupSubcommands)) {
        rows.push({
          path: `${command.name} ${option.name} ${subcommand.name}`,
          description: describe(subcommand, botLocale),
        });
      }
      continue;
    }

    rows.push({
      path: `${command.name} ${option.name}`,
      description: describe(option, botLocale),
    });
  }

  return rows;
}

function buildGroups(commands: ApplicationCommandData[], botLocale: string): CommandGroup[] {
  return sortByName(
    commands.map((command) => ({
      name: command.name,
      description: describe(command as CommandOption, botLocale),
      commands: flattenRunnableCommands(command, botLocale),
    })),
  );
}

function renderGroup(group: CommandGroup, copy: CommandReferenceCopy): string {
  const lines = [
    `## ${formatCommandPath(group.name)}`,
    "",
    group.description || copy.groupFallback(humanizeCommandName(group.name)),
    "",
    `| ${copy.commandHeader} | ${copy.summaryHeader} |`,
    "|---|---|",
  ];

  for (const command of group.commands) {
    lines.push(
      `| ${formatCommandPath(command.path)} | ${escapeTableCell(command.description || copy.noDescription)} |`,
    );
  }

  return lines.join("\n");
}

/**
 * Every slash path a user can legitimately be told to type, including the intermediate
 * root and group prefixes that prose often names on their own ("configure it under `/config`").
 *
 * Shares `buildGroups` with the reference generator so the two can never disagree about
 * what is registered.
 */
export async function collectValidCommandPaths(): Promise<Set<string>> {
  await initializeLocalizer();
  const { registrationData } = await loadCommandData();
  const paths = new Set<string>();

  for (const group of buildGroups(registrationData, "en-US")) {
    paths.add(group.name);
    for (const command of group.commands) {
      const segments = command.path.split(" ");
      for (let length = 1; length <= segments.length; length++) {
        paths.add(segments.slice(0, length).join(" "));
      }
    }
  }

  return paths;
}

/** Renders the command reference for every published docs locale, keyed by locale id. */
export async function generateCommandReferences(): Promise<Map<DocsLocaleId, string>> {
  await initializeLocalizer();
  const { registrationData } = await loadCommandData();
  const pages = new Map<DocsLocaleId, string>();

  for (const locale of PUBLISHED_DOCS_LOCALES) {
    const copy = COMMAND_REFERENCE_COPY[locale];
    const botLocale = getDocsLocaleConfig(locale)?.botLocaleCode;
    if (!copy || !botLocale) {
      throw new Error(
        `No command reference copy for published docs locale "${locale}". Add it to COMMAND_REFERENCE_COPY in scripts/lib/commandReference.ts.`,
      );
    }
    const groups = buildGroups(registrationData, botLocale);
    const runnableCommandCount = groups.reduce((total, group) => total + group.commands.length, 0);

    pages.set(
      locale,
      `---
title: "${copy.title}"
sidebar:
  order: 6
---

<!--
  GENERATED FILE: do not edit by hand.
  Run \`bun run generate-command-reference\` from the repository root.
-->

${copy.intro}

${copy.counts(groups.length, runnableCommandCount)}

${groups.map((group) => renderGroup(group, copy)).join("\n\n")}
`,
    );
  }

  return pages;
}

export async function writeCommandReferences(): Promise<string[]> {
  const written: string[] = [];
  for (const [locale, markdown] of await generateCommandReferences()) {
    const path = commandReferencePath(locale);
    await Bun.write(path, markdown);
    written.push(path);
  }
  return written;
}
