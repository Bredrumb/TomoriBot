import type { RagDocument } from "../types";

// Production chunk windows are 1,000 characters, so this locator must exceed 1,400 to exercise an unbroken run.
const locatorToken = `urn:ashglass:mirror:${"7f3c9d2e5b1a4c6f8e0d".repeat(75)}`;

const locator = `## Canonical record locator

The locator for the first folio is:

${locatorToken}

The locator is never wrapped in a message and never split at a colon.`;

const notes = `## Retrieval notes

Mirrors are checked against the locator before they are served. A record with a broken locator is copied into the slow cabinet and read by hand. The index does not store titles, so a request must arrive with either the locator or the folio number.`;

export const ashglassIndex = {
  key: "ashglass-index",
  documentName: "Ashglass mirror index",
  language: "en",
  scope: "serverwide",
  sourceText: `# Ashglass mirror index

${locator}

${notes}`,
  passages: [
    { key: "ashglass-index.locator", text: locator },
    { key: "ashglass-index.notes", text: notes },
  ],
} as const satisfies RagDocument;
