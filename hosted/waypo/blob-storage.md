# Independent application files

`services.blobs: true` enables the independent `waypo_blobs` capability once the matching core pin is qualified. It does not require `services.sync`; identity and CRDT documents remain separately optional. The hosted composition defaults this switch to **false**, including existing engineering configurations. No public signup, price, allowance or production flag changes here.

Use explicit finite `services.workBudget` and `services.workPeriodBudget` policies and the same account storage allowance as CRDT data. Files count once; storing a key reference in a document does not duplicate the file charge. The current core API buffers at most 4 MiB per file; larger streaming files remain a separate prerelease task. Existing document-owned attachment routes remain compatibility paths; new applications should use independent blob keys.

The frontend SDK consumes `waypo_blobs` discovery and existing OAuth app grants. Account/app namespaces come from verified authority. Applications must use conditional writes/deletes and resolve conflicts; the SDK does not automatically retry a possibly committed write. Document deletion never deletes a standalone file. Explicit file deletion or terminal account storage cleanup does.
