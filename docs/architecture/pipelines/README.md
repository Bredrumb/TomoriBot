---
title: "Pipelines"
sidebar:
  label: "Overview"
  groupLabel: "Pipelines"
  order: 20
---

Pipeline docs describe sequenced runtime flows: what starts them, what each stage receives,
what each stage produces, and where side effects happen.

## Read Order

- [`chat/`](./chat/) — Discord message ingress through per-turn execution
- [`context-build/`](./context-build/) — preset routing and native context assembly
- [`tool-loop/`](./tool-loop/) — tool-call dispatch and generation restart flow
- [`provider/`](./provider/) — provider request, stream normalization, and Discord delivery
- [`memory/`](./memory/) — short-term and long-term memory capture/update flows

Planned pipeline splits are tracked in the docs index until their folders exist.
