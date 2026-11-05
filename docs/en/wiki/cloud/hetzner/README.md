---
title: "Hetzner deployment"
sidebar:
  label: "Hetzner"
  hidden: true
---

The Hetzner deployment files prepare a single-host replacement for Azure. Azure remains the
production host until the staging, restore, backup, and callback checks in the
[migration runbook](./migration) pass.

The deployment source is `deploy/hetzner/` on `release`. Keep cloud deployment changes on that branch.
