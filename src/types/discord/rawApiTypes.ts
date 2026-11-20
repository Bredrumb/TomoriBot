export interface RawDiscordComponent {
  type: number;
  id?: number;
  custom_id?: string;
  style?: number;
  required?: boolean;
  placeholder?: string;
  min_length?: number;
  max_length?: number;
  min_values?: number;
  max_values?: number;
  label?: string;
  description?: string;
  content?: string;
  value?: string | boolean;
  default?: boolean;
  values?: string[];
  channel_types?: number[];
  default_values?: Array<{ id: string; type: "user" | "role" | "channel" }>;
  component?: RawDiscordComponent;
  components?: RawDiscordComponent[];
  options?: Array<{
    label: string;
    value: string;
    description?: string;
    emoji?: {
      id?: string;
      name?: string;
      animated?: boolean;
    };
    default?: boolean;
  }>;
}

export interface RawDiscordWebSocketPacket {
  op: number;
  s?: number;
  t?: string;
  d?: {
    id?: string;
    data?: {
      components?: RawDiscordComponent[];
      custom_id?: string;
      component_type?: number;
      values?: string[];
      resolved?: {
        attachments?: Record<
          string,
          {
            id: string;
            filename: string;
            size: number;
            url: string;
            proxy_url: string;
            content_type?: string;
            width?: number;
            height?: number;
            ephemeral?: boolean;
            placeholder?: string;
            placeholder_version?: number;
          }
        >;
      };
    };
    type?: number;
    application_id?: string;
    token?: string;
    guild_id?: string;
    channel_id?: string;
    user?: {
      id: string;
      username: string;
      discriminator: string;
      avatar?: string;
    };
    member?: {
      user: {
        id: string;
        username: string;
        discriminator: string;
        avatar?: string;
      };
      nick?: string;
      roles: string[];
    };
    message?: {
      id: string;
      content: string;
      components?: RawDiscordComponent[];
    };
  };
}

export interface RawDiscordShard {
  id: number;
  [key: string]: unknown;
}

export interface GlobalDiscordState {
  __webSocketPatched?: boolean;
  [key: string]: unknown;
}
