import type { CatalogSection, PersonaInput } from "../types";
import { persona as defaultEn } from "./default/en-US";
import { persona as defaultJa } from "./default/ja";
import { persona as defaultPtBr } from "./default/pt-BR";
import { persona as defaultEs419 } from "./default/es-419";
import { persona as defaultZhTw } from "./default/zh-TW";
import { persona as brattyEn } from "./bratty/en-US";
import { persona as brattyJa } from "./bratty/ja";
import { persona as brattyPtBr } from "./bratty/pt-BR";
import { persona as brattyEs419 } from "./bratty/es-419";
import { persona as brattyZhTw } from "./bratty/zh-TW";
import { persona as mesugakiJa } from "./mesugaki/ja";
import { persona as gloomyEn } from "./gloomy/en-US";
import { persona as gloomyJa } from "./gloomy/ja";
import { persona as gloomyPtBr } from "./gloomy/pt-BR";
import { persona as gloomyEs419 } from "./gloomy/es-419";
import { persona as gloomyZhTw } from "./gloomy/zh-TW";
import { persona as shyEn } from "./shy/en-US";
import { persona as shyJa } from "./shy/ja";
import { persona as shyPtBr } from "./shy/pt-BR";
import { persona as shyEs419 } from "./shy/es-419";
import { persona as shyZhTw } from "./shy/zh-TW";
import { persona as nerineEn } from "./loyal/en-US";
import { persona as nerineJa } from "./loyal/ja";
import { persona as nerinePtBr } from "./loyal/pt-BR";
import { persona as nerineEs419 } from "./loyal/es-419";
import { persona as nerineZhTw } from "./loyal/zh-TW";
import { persona as defaultVi } from "./default/vi";
import { persona as brattyVi } from "./bratty/vi";
import { persona as gloomyVi } from "./gloomy/vi";
import { persona as shyVi } from "./shy/vi";
import { persona as nerineVi } from "./loyal/vi";
import { persona as defaultZhCn } from "./default/zh-CN";
import { persona as brattyZhCn } from "./bratty/zh-CN";
import { persona as gloomyZhCn } from "./gloomy/zh-CN";
import { persona as shyZhCn } from "./shy/zh-CN";
import { persona as nerineZhCn } from "./loyal/zh-CN";
import { persona as lockeEn } from "./unhinged/en-US";
import { persona as lockeJa } from "./unhinged/ja";
import { persona as lockePtBr } from "./unhinged/pt-BR";
import { persona as lockeEs419 } from "./unhinged/es-419";
import { persona as lockeZhTw } from "./unhinged/zh-TW";
import { persona as lockeVi } from "./unhinged/vi";
import { persona as lockeZhCn } from "./unhinged/zh-CN";

export const personaSections: CatalogSection<PersonaInput>[] = [
  { comment: "Tomori-kun", rows: [defaultEn] },
  { comment: "Tomori-chan", rows: [brattyEn] },
  { comment: "Tomori-san", rows: [gloomyEn] },
  { comment: "Shy Tomori (Lilya)", rows: [shyEn] },
  { comment: "Nerine (Discontinued Model)", rows: [nerineEn] },
  { comment: "Unhinged Tomori (Locke)", rows: [lockeEn] },
  { comment: "Tomori-kun (Japanese)", rows: [defaultJa] },
  // The メスガキトモリ label moves from 716/ja to 256/ja, so the renamed row must seed first:
  // persona_preset_name is globally unique and rows apply in this order.
  { comment: "Tomori-chan (Japanese)", rows: [brattyJa] },
  { comment: "オボニャ (Japanese)", rows: [mesugakiJa] },
  { comment: "Tomori-san (Japanese)", rows: [gloomyJa] },
  { comment: "Shy Tomori (Lilya) Japanese Version", rows: [shyJa] },
  { comment: "ネリネ（廃盤モデル）(Japanese)", rows: [nerineJa] },
  { comment: "Unhinged Tomori (Japanese)", rows: [lockeJa] },
  { comment: "Tomori-kun (Brazilian Portuguese)", rows: [defaultPtBr] },
  { comment: "Tomori-chan (Brazilian Portuguese)", rows: [brattyPtBr] },
  { comment: "Tomori-san (Brazilian Portuguese)", rows: [gloomyPtBr] },
  { comment: "Shy Tomori (Lilya) Brazilian Portuguese Version", rows: [shyPtBr] },
  { comment: "Loyal Tomori (Brazilian Portuguese)", rows: [nerinePtBr] },
  { comment: "Unhinged Tomori (Brazilian Portuguese)", rows: [lockePtBr] },
  { comment: "Tomori-kun (Latin American Spanish)", rows: [defaultEs419] },
  { comment: "Tomori-chan (Latin American Spanish)", rows: [brattyEs419] },
  { comment: "Tomori-san (Latin American Spanish)", rows: [gloomyEs419] },
  { comment: "Shy Tomori (Lilya) Latin American Spanish Version", rows: [shyEs419] },
  { comment: "Loyal Tomori (Latin American Spanish)", rows: [nerineEs419] },
  { comment: "Unhinged Tomori (Latin American Spanish)", rows: [lockeEs419] },
  { comment: "Tomori-kun (Traditional Chinese)", rows: [defaultZhTw] },
  { comment: "Tomori-chan (Traditional Chinese)", rows: [brattyZhTw] },
  { comment: "Tomori-san (Traditional Chinese)", rows: [gloomyZhTw] },
  { comment: "Shy Tomori (Lilya) Traditional Chinese Version", rows: [shyZhTw] },
  { comment: "Loyal Tomori (Traditional Chinese)", rows: [nerineZhTw] },
  { comment: "Unhinged Tomori (Traditional Chinese)", rows: [lockeZhTw] },
  { comment: "Tomori-kun (Vietnamese)", rows: [defaultVi] },
  { comment: "Tomori-chan (Vietnamese)", rows: [brattyVi] },
  { comment: "Tomori-san (Vietnamese)", rows: [gloomyVi] },
  { comment: "Shy Tomori (Lilya) Vietnamese Version", rows: [shyVi] },
  { comment: "Loyal Tomori (Vietnamese)", rows: [nerineVi] },
  { comment: "Unhinged Tomori (Vietnamese)", rows: [lockeVi] },
  { comment: "Tomori-kun (Simplified Chinese)", rows: [defaultZhCn] },
  { comment: "Tomori-chan (Simplified Chinese)", rows: [brattyZhCn] },
  { comment: "Tomori-san (Simplified Chinese)", rows: [gloomyZhCn] },
  { comment: "Shy Tomori (Lilya) Simplified Chinese Version", rows: [shyZhCn] },
  { comment: "Loyal Tomori (Simplified Chinese)", rows: [nerineZhCn] },
  { comment: "Unhinged Tomori (Simplified Chinese)", rows: [lockeZhCn] },
];
