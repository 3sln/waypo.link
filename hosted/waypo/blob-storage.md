# Independent application files

`services.blobs: true` selects app-private key/blob storage, independently of `services.logs`. The provider advertises only the capabilities supported by its configured and qualified runtime. The generic hosted composition defaults blobs off. The initial-free preset explicitly selects blobs; it does not supply an affordable physical capacity policy, open signup, or enable billing.

Use explicit finite `services.storageCapacity`, `services.workBudget` and `services.workPeriodBudget` policies. Included owner and essential-cleanup reserves come from the same total wallet; size them against the audited maximum-operation matrix before enabling storage. The small checked-in closed identity-only preview is not an enabled-storage or large-file configuration. Persisted wallet-policy changes require explicit migration and never reset spent work.

Files and retained log entries share the account's logical allowance. An app can publish a blob key in its own log/state; that reference does not duplicate the file's byte charge. Creating a file and publishing its reference are separate operations. Trimming logs or compacting an app's CRDT never deletes a standalone key. Apps explicitly reconcile unused files using conditional deletion.

The bounded key/blob API supports conditional creation/replacement/deletion. Its legacy transfer surface is limited to4MiB and buffers that bounded object; do not increase its buffer limit to promise larger files. Optional native multipart/streaming transfer has its own capability/readiness and reservation requirements. Direct provider-signed URLs, when explicitly configured, are read-only. Writes pass through Waypo's admission and cost guards. Direct GET remains off by default because replayed URLs can still incur provider request/egress costs.

```js
const provider = {...operatorConfig, services: {
  ...operatorConfig.services,
  ...WAYPO_LINK_INITIAL_FREE_STORAGE_SERVICES,
  // Supply reviewed storageCapacity/workBudget/workPeriodBudget explicitly.
}};
const composed = composeWaypoLinkProviderConfiguration(provider, freeSettings);
```

Neither this preset nor a populated metadata field proves the actual Worker, self-hosted storage, cleanup, export or public deployment path. Those remain scoped release gates. Paid plans, public admission, destructive retention and production routes stay disabled in the checked-in preview.
