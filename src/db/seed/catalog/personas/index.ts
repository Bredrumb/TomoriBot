import type { CatalogSection, PersonaInput } from "../types";
import { persona as defaultEn } from "./default/en-US";
import { persona as defaultJa } from "./default/ja";
import { persona as brattyEn } from "./bratty/en-US";
import { persona as brattyJa } from "./bratty/ja";
import { persona as gloomyEn } from "./gloomy/en-US";
import { persona as gloomyJa } from "./gloomy/ja";
import { persona as shyEn } from "./shy/en-US";
import { persona as shyJa } from "./shy/ja";
import { persona as nerineEn } from "./loyal/en-US";
import { persona as nerineJa } from "./loyal/ja";

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
];
