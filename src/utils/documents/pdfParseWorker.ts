// Worker must hold no shared state because pdf-parse has no abort and the caller enforces deadlines by terminating
// the worker.
import pdfParse from "pdf-parse";

declare const self: Worker;

export type PdfParseReply = { text: string } | { error: string };

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  let reply: PdfParseReply;
  try {
    const parsed = await pdfParse(Buffer.from(event.data));
    reply = { text: parsed.text ?? "" };
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : "PDF parse failed" };
  }
  self.postMessage(reply);
};
