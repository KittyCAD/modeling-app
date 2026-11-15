# Cloud project runtime

This runtime owns account-backed project state: remote project listings, open
project records, revision-checked save queues, reconciliation, thumbnail staging,
and in-flight refreshes. Its filesystem facade lets the application mount these
projects alongside directory storage without exposing that state to file callers.

The runtime uses `fs-zds/memory` for owned bytes and directory entries and implements
`IZooDesignStudioFS`. Generic filesystem implementations retain their own storage
resources; cloud project identity, persistence policy, and lifecycle live here.
