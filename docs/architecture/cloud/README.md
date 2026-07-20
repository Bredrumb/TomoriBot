---
title: "Cloud"
sidebar:
  label: "Overview"
  groupLabel: "Cloud"
  order: 50
---

Cloud docs describe how TomoriBot's production infrastructure runs on Azure: deployment
targets, log/metric ingestion, and the operational rules around them. The AWS and GCP
deployment code is retained as legacy rollback and self-hosting reference; TomoriBot's
managed GCP project was retired after the Azure cutover on 2026-07-20. Provider-agnostic
hosting on your own machines lives under [Self-Hosting](/self-hosting/) instead.

The small `tomoribot-vertex` GCP project is retained only as an outbound AI provider. It
does not host TomoriBot infrastructure.

## Pages

- [`azure-production-deployment.md`](./azure-production-deployment/) — OIDC/Run Command deployment,
  database-role bootstrap, host lockdown, and production operating rules
- [`azure-application-logs.md`](./azure-application-logs/) — shipping structured error logs
  from an Azure VM into Log Analytics and Grafana
- [`azure-terraform-state-recovery.md`](./azure-terraform-state-recovery/) — blob-version restore and
  stale Terraform lock recovery
- [`azure-vertex-auth.md`](./azure-vertex-auth/) — keyless authentication from the Azure VM
  to Google Vertex AI
