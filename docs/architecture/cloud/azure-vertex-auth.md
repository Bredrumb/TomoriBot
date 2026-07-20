---
title: "Azure to Vertex AI Authentication"
sidebar:
  label: "Vertex AI Authentication"
  order: 20
---

TomoriBot runs on an Azure VM but can call Google Vertex AI without storing a Google service
account key. Production uses Google Cloud Workload Identity Federation (WIF) and the Azure VM's
system-assigned managed identity.

## Production identity flow

1. TomoriBot reads the non-secret external-account configuration from
   `/run/secrets/google-vertex-wif.json`.
2. Google Auth obtains a managed identity token from Azure Instance Metadata Service (IMDS).
3. Google Security Token Service accepts that token only when its `xms_mirid` claim matches the
   production VM resource ID.
4. The federated principal impersonates
   `tomoribot-azure-vertex@tomoribot-vertex.iam.gserviceaccount.com`.
5. That service account calls Vertex AI in the `tomoribot-vertex` project.

No Google private key or API key is stored on the VM. The checked-in
[`deploy/azure/google-vertex-wif.json`](../../../deploy/azure/google-vertex-wif.json) file contains
only public federation metadata.

## Google Cloud boundary

- Project ID: `tomoribot-vertex`
- Project purpose: Vertex AI provider calls only; it does not host TomoriBot infrastructure
- Workload identity pool/provider: `tomoribot-azure/azure-vm`
- Runtime service account roles: Vertex AI User and Service Usage Consumer
- Service account binding: Workload Identity User for principals admitted by the pool
- Provider condition: exact Azure production VM resource ID (`xms_mirid`)

The Azure VM must retain its system-assigned identity. Terraform declares this in
`terraform/azure/vm.tf` so a future apply does not remove it.

## Deployment

The Azure deployment workflow installs the federation file at
`/etc/tomoribot/google-vertex-wif.json` with owner `root`, group ID `1001`, and mode `0640`.
Docker Compose mounts it read-only and sets `GOOGLE_APPLICATION_CREDENTIALS` to the container
path. Treat write access to the host copy as privileged even though the file is not a secret:
changing its audience or impersonation target changes the identity TomoriBot requests.

## Discord configuration

Run `/provider add`, choose **Google Vertex AI**, and enter:

```text
tomoribot-vertex::global
```

The saved value is the Google project and location, not a credential. The Azure workload identity
provides the credential at runtime. **Google Vertex AI Express** is a separate API-key provider and
does not use this path.

## Verification

After deployment, verify that the container is healthy, the credential file is mounted read-only,
and a small Vertex request succeeds. `countTokens` is suitable for an authentication smoke test
because it exercises ADC, federation, service-account impersonation, and the Vertex endpoint
without generating a model response.

Billing budgets and alerts are monitoring controls, not hard spending caps. Keep this project free
of unrelated resources so its billing activity is attributable to Vertex usage.
