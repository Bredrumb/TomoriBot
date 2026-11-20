import type { RagDocument } from "../types";

const overview = `## Overview

The Tidewright beacon reports wind, swell, and lamp status once per quarter hour. The endpoint accepts a single beacon name and returns the most recent frame. Clients that need history should request the archive endpoint instead.`;

const readings = Array.from({ length: 48 }, (_, index) => {
  const slot = String(index).padStart(2, "0");
  const wind = 3 + (index % 7);
  const swell = 1 + (index % 5);
  return `{"slot":"${slot}","wind_knots":${wind},"swell_tenths":${swell},"lamp":"steady"}`;
}).join(",");

const sample = `## Sample response

The beacon returns one frame per quarter hour:

\`\`\`json
{"beacon":"Juno North","readings":[${readings}],"status":"nominal","checked_by":"north light keeper"}
\`\`\`

A client should read the status field before the readings.`;

const errorCodes = `## Error codes

- 401 means the key is missing or expired.
- 404 means the beacon name is not in the registry.
- 503 means the lamp controller is restarting, so the client should retry after the next quarter hour.`;

export const tidewrightApi = {
  key: "tidewright-api",
  documentName: "Tidewright beacon API",
  language: "en",
  scope: "serverwide",
  sourceText: `# Tidewright beacon API

${overview}

${sample}

${errorCodes}`,
  passages: [
    { key: "tidewright-api.overview", text: overview },
    { key: "tidewright-api.sample", text: sample },
    { key: "tidewright-api.error-codes", text: errorCodes },
  ],
} as const satisfies RagDocument;
