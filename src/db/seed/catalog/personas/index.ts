import type { CatalogSection, PersonaInput } from "../types";
import { persona as defaultEn } from "./default/en-US";
import { persona as defaultJa } from "./default/ja";
import { persona as defaultPtBr } from "./default/pt-BR";
import { persona as defaultZhTw } from "./default/zh-TW";
import { persona as brattyEn } from "./bratty/en-US";
import { persona as brattyJa } from "./bratty/ja";
import { persona as brattyPtBr } from "./bratty/pt-BR";
import { persona as brattyZhTw } from "./bratty/zh-TW";
import { persona as gloomyEn } from "./gloomy/en-US";
import { persona as gloomyJa } from "./gloomy/ja";
import { persona as gloomyPtBr } from "./gloomy/pt-BR";
import { persona as gloomyZhTw } from "./gloomy/zh-TW";
import { persona as shyEn } from "./shy/en-US";
import { persona as shyJa } from "./shy/ja";
import { persona as shyPtBr } from "./shy/pt-BR";
import { persona as shyZhTw } from "./shy/zh-TW";
import { persona as nerineEn } from "./loyal/en-US";
import { persona as nerineJa } from "./loyal/ja";
import { persona as nerinePtBr } from "./loyal/pt-BR";
import { persona as nerineZhTw } from "./loyal/zh-TW";

export const personaSections: CatalogSection<PersonaInput>[] = [
  { comment: "Tomori-kun", rows: [defaultEn] },
  { comment: "Tomori-chan", rows: [brattyEn] },
  { comment: "Tomori-san", rows: [gloomyEn] },
  { comment: "Shy Tomori (Lilya)", rows: [shyEn] },
  { comment: "Nerine (Discontinued Model)", rows: [nerineEn] },
  { comment: "Tomori-kun (Japanese)", rows: [defaultJa] },
  { comment: "Tomori-chan (Japanese)", rows: [brattyJa] },
  { comment: "Tomori-san (Japanese)", rows: [gloomyJa] },
  { comment: "Shy Tomori (Lilya) Japanese Version", rows: [shyJa] },
  { comment: "ネリネ（廃盤モデル）(Japanese)", rows: [nerineJa] },
  { comment: "Tomori-kun (Brazilian Portuguese)", rows: [defaultPtBr] },
  { comment: "Tomori-chan (Brazilian Portuguese)", rows: [brattyPtBr] },
  { comment: "Tomori-san (Brazilian Portuguese)", rows: [gloomyPtBr] },
  { comment: "Shy Tomori (Lilya) Brazilian Portuguese Version", rows: [shyPtBr] },
  { comment: "Loyal Tomori (Brazilian Portuguese)", rows: [nerinePtBr] },
  { comment: "Tomori-kun (Traditional Chinese)", rows: [defaultZhTw] },
  { comment: "Tomori-chan (Traditional Chinese)", rows: [brattyZhTw] },
  { comment: "Tomori-san (Traditional Chinese)", rows: [gloomyZhTw] },
  { comment: "Shy Tomori (Lilya) Traditional Chinese Version", rows: [shyZhTw] },
  { comment: "Loyal Tomori (Traditional Chinese)", rows: [nerineZhTw] },
];
