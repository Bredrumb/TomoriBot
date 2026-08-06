import type { AssembledServerConfig, ServerMemberPermissionsConfigRow } from "@/types/db/schema";

type BooleanColumn<T> = {
  [K in keyof T]-?: T[K] extends boolean ? K : never;
}[keyof T];

type ServerMemberPermissionsBooleanColumn = BooleanColumn<ServerMemberPermissionsConfigRow>;

type ServerMemberPermissionsCommandColumn = Extract<
  ServerMemberPermissionsBooleanColumn,
  | "server_memteaching_enabled"
  | "attribute_memteaching_enabled"
  | "sampledialogue_memteaching_enabled"
  | "prompt_snapshot_enabled"
>;

export type ServerMemberPermissionsCommandConfigState = Pick<
  AssembledServerConfig,
  ServerMemberPermissionsCommandColumn
>;

export interface ServerMemberPermissionDefinition {
  value: string;
  dbColumn: ServerMemberPermissionsCommandColumn;
  labelKey: string;
  descKey: string;
  getState: (config: ServerMemberPermissionsCommandConfigState) => boolean;
}

interface ServerMemberPermissionsConfigChange {
  value: string;
  dbColumn: ServerMemberPermissionsCommandColumn;
  isEnabled: boolean;
  labelKey: string;
}

export interface ServerMemberPermissionsConfigWritePlan {
  method: "updateMemberPermissionsConfig";
  patch: Partial<ServerMemberPermissionsConfigRow>;
  changes: ServerMemberPermissionsConfigChange[];
}

export const SERVER_MEMBER_PERMISSION_DEFINITIONS: readonly ServerMemberPermissionDefinition[] = [
  {
    value: "servermemories",
    dbColumn: "server_memteaching_enabled",
    labelKey: "commands.server.member-permissions.servermemories_option",
    descKey: "commands.server.member-permissions.servermemories_desc",
    getState: (c) => c.server_memteaching_enabled,
  },
  {
    value: "attributelist",
    dbColumn: "attribute_memteaching_enabled",
    labelKey: "commands.server.member-permissions.attributelist_option",
    descKey: "commands.server.member-permissions.attributelist_desc",
    getState: (c) => c.attribute_memteaching_enabled,
  },
  {
    value: "sampledialogues",
    dbColumn: "sampledialogue_memteaching_enabled",
    labelKey: "commands.server.member-permissions.sampledialogues_option",
    descKey: "commands.server.member-permissions.sampledialogues_desc",
    getState: (c) => c.sampledialogue_memteaching_enabled,
  },
  {
    value: "promptsnapshot",
    dbColumn: "prompt_snapshot_enabled",
    labelKey: "commands.server.member-permissions.promptsnapshot_option",
    descKey: "commands.server.member-permissions.promptsnapshot_desc",
    getState: (c) => c.prompt_snapshot_enabled,
  },
];

export function buildServerMemberPermissionsConfigWritePlan(
  config: ServerMemberPermissionsCommandConfigState,
  selectedValues: Iterable<string>,
): ServerMemberPermissionsConfigWritePlan {
  const selectedValueSet = new Set(selectedValues);
  const changes: ServerMemberPermissionsConfigChange[] = [];
  const patch: Partial<ServerMemberPermissionsConfigRow> = {};

  for (const def of SERVER_MEMBER_PERMISSION_DEFINITIONS) {
    const wasEnabled = def.getState(config);
    const isEnabled = selectedValueSet.has(def.value);
    if (wasEnabled === isEnabled) continue;

    const change: ServerMemberPermissionsConfigChange = {
      value: def.value,
      dbColumn: def.dbColumn,
      isEnabled,
      labelKey: def.labelKey,
    };
    changes.push(change);
    patch[change.dbColumn] = change.isEnabled;
  }

  return {
    method: "updateMemberPermissionsConfig",
    patch,
    changes,
  };
}
