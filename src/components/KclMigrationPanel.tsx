import { useSignals } from '@preact/signals-react/runtime'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import { equalBytes } from '@src/lib/kclMigration/snapshot'
import { createTwoFilesPatch } from 'diff'
import { useMemo, useState } from 'react'

export function KclMigrationPanel({
  controller,
  enabled,
  sourceIsKcl2,
  chatBusy,
}: {
  controller: MigrationController
  enabled: boolean
  sourceIsKcl2: boolean
  chatBusy: boolean
}) {
  useSignals()
  const [open, setOpen] = useState(controller.phase.peek() !== 'idle')
  const [consent, setConsent] = useState(false)
  const phase = controller.phase.value
  const busy = controller.busy
  const original = controller.original.value?.files
  const candidate = controller.candidate.value
  const operation = controller.operation.value
  const active = phase !== 'idle'
  const changes = useMemo(() => {
    if (!original || !candidate) return []
    const decoder = new TextDecoder()
    return [...candidate].flatMap(([path, after]) => {
      const before = original.get(path)
      return before && !equalBytes(before, after)
        ? [
            {
              path,
              diff:
                createTwoFilesPatch(
                  path,
                  path,
                  decoder.decode(before),
                  decoder.decode(after),
                  undefined,
                  undefined,
                  { timeout: 100, maxEditLength: 10_000 }
                ) ?? 'This diff is too large to display.',
            },
          ]
        : []
    })
  }, [original, candidate])
  if ((!enabled || !sourceIsKcl2) && !active) return null

  return (
    <section
      aria-label="KCL migration"
      className="m-4 min-w-0 rounded-md border border-chalkboard-30 p-4 dark:border-chalkboard-70"
    >
      <button
        type="button"
        className="font-semibold text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {active ? 'KCL Migration' : 'Migrate to KCL 3'}
      </button>
      {open && (
        <div>
          <h3 className="mt-3 font-semibold">
            Migrate Project to KCL 3 Preview
          </h3>
          <p className="my-3 text-sm">
            Free project conversion, with up to 20 minutes for conversion and
            validation. Review the changes before applying. Your original stays
            unchanged until you apply.
          </p>
          {['idle', 'failed', 'cancelled'].includes(phase) && (
            <label className="my-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              I agree to migrate to KCL 3 preview, which may change before the
              stable release.
            </label>
          )}
          <p role="status" aria-live="polite" className="my-3 text-sm">
            {phase === 'capturing'
              ? 'Capturing the project...'
              : phase === 'connecting'
                ? 'Connecting...'
                : phase === 'running'
                  ? 'Converting and validating the project...'
                  : phase === 'cancelling'
                    ? 'Cancelling...'
                    : phase === 'applying'
                      ? 'Applying project changes...'
                      : phase === 'undoing'
                        ? 'Restoring the original project...'
                        : controller.detail.value}
          </p>
          {operation && ['running', 'cancelling'].includes(phase) && (
            <p className="text-sm">
              Execution deadline:{' '}
              {new Date(operation.deadline).toLocaleTimeString()}
            </p>
          )}
          {phase === 'review' && (
            <>
              <h3 className="mt-4 font-semibold">Review Changes</h3>
              <p className="my-2 text-sm">
                {operation?.result?.validation?.summary}
              </p>
              {changes.length === 0 && <p>No file changes were returned.</p>}
              {changes.map(({ path, diff }) => (
                <details
                  key={path}
                  open={changes.length === 1}
                  className="my-3 border border-chalkboard-30 rounded p-2"
                >
                  <summary className="cursor-pointer font-mono text-sm">
                    {path}
                  </summary>
                  <pre className="overflow-auto max-h-72 p-2 text-xs whitespace-pre">
                    {diff.slice(0, 100_000)}
                  </pre>
                  {diff.length > 100_000 && (
                    <p className="text-sm">Diff shortened.</p>
                  )}
                </details>
              ))}
            </>
          )}
          <div className="mt-5 flex flex-wrap gap-3 text-sm [&>button]:rounded [&>button]:border [&>button]:border-chalkboard-40 [&>button]:px-3 [&>button]:py-1.5 [&>button:disabled]:opacity-50">
            {['idle', 'failed', 'cancelled'].includes(phase) && (
              <button
                type="button"
                disabled={!enabled || !sourceIsKcl2 || !consent || chatBusy}
                onClick={() => {
                  if (!chatBusy) void controller.start(consent)
                }}
              >
                Start Free Migration
              </button>
            )}
            {['capturing', 'connecting', 'running'].includes(phase) && (
              <button type="button" onClick={() => controller.cancel()}>
                Cancel Migration
              </button>
            )}
            {phase === 'disconnected' && (
              <button
                type="button"
                onClick={() => {
                  void controller.recover()
                }}
              >
                Check Final Status
              </button>
            )}
            {phase === 'review' && (
              <button
                type="button"
                disabled={!enabled || chatBusy}
                onClick={() => {
                  if (!chatBusy) void controller.apply()
                }}
              >
                Apply Migration
              </button>
            )}
            {phase === 'applied' && (
              <button
                type="button"
                disabled={chatBusy}
                onClick={() => {
                  if (!chatBusy) void controller.undo()
                }}
              >
                Undo Migration
              </button>
            )}
          </div>
          {chatBusy && !busy && (
            <p className="mt-3 text-sm">
              Wait for the current Zookeeper request and queued messages to
              finish before migrating or changing project files.
            </p>
          )}
          {busy && (
            <p className="mt-3 text-sm">
              You can continue this chat when the migration finishes.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
