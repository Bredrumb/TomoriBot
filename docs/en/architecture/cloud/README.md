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
managed GCP project was retired after the Azure cutover. Provider-agnostic
hosting on your own machines lives under [Self-Hosting](/self-hosting/) instead.

A small dedicated GCP project is retained only as an outbound AI provider. It
does not host TomoriBot infrastructure.

## Pages

- [`azure-production-deployment.md`](./azure-production-deployment/) — OIDC/Run Command deployment,
  database-role bootstrap, host lockdown, and production operating rules
- [`azure-application-logs.md`](./azure-application-logs/) — shipping structured error logs
  from an Azure VM into Log Analytics and Grafana
- [`azure-vertex-auth.md`](./azure-vertex-auth/) — keyless authentication from the Azure VM
  to Google Vertex AI

Two procedures act on one specific deployment rather than describing the architecture, so they live
in the hidden wiki instead of here:
[Terraform State Recovery](/wiki/azure-terraform-state-recovery/) and
[Production Data Inspection](/wiki/azure-production-inspection/).
