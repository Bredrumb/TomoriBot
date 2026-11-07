---
title: "Documents"
sidebar:
  order: 3
aiGenerated: false
---

Documents give TomoriBot a knowledge base she searches while she replies: a game's rulebook, a
server FAQ, a wiki export, or story notes. They hold material too long to be a
[long-term memory](/features/knowledge/memory/long-term-memory/).

## Why use documents

An active long-term memory is sent in full with every reply, so each one costs prompt space whether
or not the conversation needs it. A document is searched instead. Each reply receives at most 10
passages that match the conversation, so even a 40-page rulebook adds at most about three pages
of text to a reply, and the sections nobody asks about cost nothing.

Use a long-term memory for a short fact she should always know. Use a document for reference material
she should look up when it comes up.

## How search works

When you add a document, TomoriBot splits it into passages of a few paragraphs each, called chunks.
An embedding model then turns each chunk into a list of numbers that describes what it means.
Chunks about similar topics get similar numbers even when they use different words.

On each message, she turns the latest message into numbers the same way and picks the chunks
closest in meaning. She also checks for chunks that share exact words, which catches names and
invented terms that an embedding model may not know. The best matches go into her prompt for that
reply. This technique is called retrieval-augmented generation (RAG).

For example, a document says "Guild members meet every Friday at the docks." Asking "when does the
guild get together?" finds that chunk even though the question never says "meet" or "Friday".

Because she sees only the matched chunks, she cannot summarize a whole document or count things
across it. Questions about a specific detail work best. Markdown headings help: each chunk keeps
its section headings, so a well-organized document gives clearer matches.

## Setting up documents

Documents need an embedding model. Choose one in the `Embeddings` slot; see
[Providers & Models](/features/setup-administration/providers-and-models/).

Manage documents under `/memories` > `Documents`. Choose `Add new Document` to upload a `.txt`,
`.md`, or `.pdf` file. A document can belong to one persona or be shared across personas, and can
be limited to selected channels and their threads. You can read the stored chunks and edit or
remove any of them. To turn a long server memory into a document, open it in `/memories` and choose
`Vectorize`.

On new servers, document management is restricted to members with `Manage Server` by default;
managers can grant access through `/moderation` > `Member Access`.

## Document limits

By default, a file can be up to 4 MB and its text up to 120,000 characters (about 20,000 English
words), split into at most 150 chunks. Each persona's documents, and the shared set, can hold 20
documents and 1,000 chunks. Self-hosters can change these limits with `MAX_DOCUMENT_SIZE_MB`,
`MAX_DOCUMENT_TEXT_LENGTH`, `MAX_DOCUMENT_CHUNKS`, `MAX_DOCUMENTS_PER_SERVER`, and
`MAX_DOCUMENT_CHUNKS_PER_SERVER`.

## Learning from chat history

`/learn history` reads up to 100 messages in the current channel, extracts the facts in them, and
saves the facts as a document. It requires `Manage Server` and a model that supports structured
output.

History imports offer prompts for conversation, roleplay, and a persona's point of view. You can
review and adjust the prompt before importing. Choose who learns the result with `learner`: one
persona (the main persona if left blank), each persona that spoke, or all personas together.
