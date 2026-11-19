# Cloud project runtime

This runtime owns account-backed project state: remote project listings, open
project records, revision-checked save queues, reconciliation, thumbnail staging,
and in-flight refreshes. Its filesystem facade lets the application mount these
projects alongside directory storage without exposing that state to file callers.

The runtime uses `fs-zds/memory` for owned bytes and directory entries and implements
`IZooDesignStudioFS`. Generic filesystem implementations retain their own storage
resources; cloud project identity, persistence policy, and lifecycle live here.

## Archive limits

Cloud project ZIPs support up to 1 GiB (1,073,741,824 bytes) of compressed
archive data and up to 1 GiB of total expanded contents, with at most 10,000 ZIP
entries, including directories. These are inclusive limits.

This is the product budget [agreed in #15208](https://github.com/KittyCAD/modeling-app/issues/15208#issuecomment-7016007659),
using the binary units from that discussion. The API transport ceiling is not a
safe browser memory budget: the runtime retains the archive, decompression buffers,
and opened project contents in memory. Compressed and expanded sizes are checked
separately against the same budget; neither may bypass it. The entry cap also bounds
per-entry processing and metadata. Actual streamed bytes remain bounded even when
ZIP metadata understates the expanded size. Unsafe paths, duplicate paths, and
symbolic links remain rejected.

Projects over these limits can use a Directory library in the desktop app. Cloud
support beyond this budget would require a different loading strategy rather than
removing the decompression bounds.

Boundary tests use small configurable byte budgets and empty files for the entry
limit, so they do not need gigabyte-sized fixtures.
