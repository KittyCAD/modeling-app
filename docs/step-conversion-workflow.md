# STEP conversion workflow

This extends the File-menu experiment in #13616 toward
[roadmap #564](https://github.com/KittyCAD/roadmap/issues/564).

The project menu's **Convert file…** action and the desktop File menu select a
STEP/STP file. A confirmation explains reasoning-credit usage and the need to
check geometry and parameter edits. Starting captures the destination project
and saves the source before submitting a separate Zookeeper conversation.
The request activates the STEP skill, asks for native parameterized KCL, and
requests geometry comparison when that tool is available.

The application owns the conversion queue, outside the project and Zookeeper
panes. Users can keep working or switch projects while queued/running status
remains visible. Successful results retain Zookeeper's final notes and expose
**Open KCL**. Opening writes to a unique folder in the original project; opening
again does not overwrite subsequent user edits. Returned paths, size, KCL syntax,
and native import dependencies are validated before completion.

The queue stores source File objects, results, and status in IndexedDB, scoped
to the signed-in account. Tokens remain in memory. A reload or app restart turns
interrupted work into a clear failure with an explicit, credit-bearing retry.
Connection loss, denied access, invalid output, and timeout are also retryable.
Retry creates a new attempt; it does not claim to resume an existing remote turn.
Signing out aborts the active connection and clears visible account state.

Background execution means **while ZDS remains open**. This does not implement
a durable server job that continues through closing the application. Closing a
pane does not stop the job; closing ZDS requires recovery/retry. Browser storage
can be cleared or exhausted. If persisting a completed result fails, the UI keeps
it in memory and asks the user to open it before closing ZDS. These limitations
are surfaced in the start notice and errors.

## Validation

- `src/lib/stepConversion.test.ts` checks serialization, source persistence
  failures, interrupted-job recovery, explicit retry, account isolation, token
  refresh, result storage failure, native import boundaries using the real KCL
  parser, and JSON/MessagePack socket completion/error/cancellation.
- `src/components/StepConversions.test.tsx` checks pre-start notices, cancellation,
  all four statuses, retry confirmation, opening in the original project,
  preserving user edits, and recovery from disk-write failure.
- `src/hooks/useStepFilePicker.test.tsx` covers repeated cancellation, selecting
  the same file again, duplicate clicks, and dialog/read failures.
- The existing desktop native-menu scenario now expects the confirmation dialog
  and uses the native picker contract. It does not spend inference credits.
- A local Chrome check exercised the real IndexedDB adapter across page reload:
  source bytes remained intact, completed output survived, interrupted work did
  not auto-run, explicit retry completed once, and another account saw no jobs.

Run the focused suite with:

```sh
npx vitest run --project unit src/lib/stepConversion.test.ts \
  src/components/StepConversions.test.tsx src/hooks/useStepFilePicker.test.tsx \
  src/lib/stepToKcl.test.ts
```

Geometry reconstruction, measured repair, and two successful independent edits
are evaluated separately by the fixed development set in
[text-to-cad #4710](https://github.com/KittyCAD/text-to-cad/pull/4710).
Passing UI tests does not establish those geometry acceptance criteria.
