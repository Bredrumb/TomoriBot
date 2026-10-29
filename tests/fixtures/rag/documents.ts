import { ashglassIndex } from "./documents/ashglassIndex";
import { caldorLedger } from "./documents/caldorLedger";
import { conceicaoTide } from "./documents/conceicaoTide";
import { costaBrasa } from "./documents/costaBrasa";
import { junoCharacterCard } from "./documents/junoCharacterCard";
import { junoFacts } from "./documents/junoFacts";
import { lanternLedger } from "./documents/lanternLedger";
import { lumenGazetteer } from "./documents/lumenGazetteer";
import { mistHarbor } from "./documents/mistHarbor";
import { ostrelLight } from "./documents/ostrelLight";
import { sableQuay } from "./documents/sableQuay";
import { shioTsumugi } from "./documents/shioTsumugi";
import { songBac } from "./documents/songBac";
import { tidewrightApi } from "./documents/tidewrightApi";
import { veyraArchive } from "./documents/veyraArchive";
import { veyraSignage } from "./documents/veyraSignage";
import type { RagDocument } from "./types";

export const RAG_DOCUMENTS = [
  veyraArchive,
  caldorLedger,
  tidewrightApi,
  junoCharacterCard,
  junoFacts,
  ashglassIndex,
  sableQuay,
  shioTsumugi,
  lanternLedger,
  mistHarbor,
  ostrelLight,
  conceicaoTide,
  costaBrasa,
  songBac,
  lumenGazetteer,
  veyraSignage,
] as const satisfies readonly RagDocument[];

export type RagPassageKey = (typeof RAG_DOCUMENTS)[number]["passages"][number]["key"];
