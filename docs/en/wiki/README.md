---
title: "Wiki"
sidebar:
  hidden: true
---

<!-- Hidden top-level folder (no navbar entry): sidebar.hidden hides the whole wiki
     group from main navigation. Reachable only via in-page hyperlinks. Keeps
     refactor-record.md and threat-models.md. See docs-site-restructure.md decision 7. -->

Internal reference notes, reachable only via links from other pages.

- [`refactor-record`](./refactor-record) — historical plugin-architecture-prerequisite refactor record
- [`threat-models`](./threat-models) — security threat models
- [`azure-production-inspection`](./azure-production-inspection) — read-only production triage through VM Run Command, plus host memory/swap forensics
- [`azure-terraform-state-recovery`](./azure-terraform-state-recovery) — blob-version restore and stale Terraform lock recovery

The two Azure pages are operator runbooks for the single production deployment. They name real
resources on purpose, because substituting placeholders in a runbook makes it wrong. Guides written
for self-hosters belong in [Cloud](/architecture/cloud/) and use placeholders instead.
