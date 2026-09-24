import { Dialog } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import type { MigrationController } from '@src/lib/kclMigration/controller'
import { equalBytes, type ProjectFiles } from '@src/lib/kclMigration/snapshot'
import { reportRejection } from '@src/lib/trap'
import { createTwoFilesPatch } from 'diff'
import JSZip from 'jszip'
import { useMemo, useState } from 'react'

async function downloadProject(files: ProjectFiles, name: string) {
  const zip = new JSZip()
  for (const [path, bytes] of files) zip.file(path, bytes)
  const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function KclMigrationDialog({
  controller,
  enabled,
  sourceIsKcl2,
  className = '',
}: {
  controller: MigrationController
  enabled: boolean
  sourceIsKcl2: boolean
  className?: string
}) {
  useSignals()
  const [open, setOpen] = useState(false)
  const [consent, setConsent] = useState(false)
  const phase = controller.phase.value
  const busy = [
    'capturing',
    'connecting',
    'running',
    'cancelling',
    'applying',
    'undoing',
  ].includes(phase)
  const writing = phase === 'applying' || phase === 'undoing'
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
                ) ??
                'This diff is too large to display. Download the original and candidate to review the complete files.',
            },
          ]
        : []
    })
  }, [original, candidate])
  if ((!enabled || !sourceIsKcl2) && !active) return null

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {active ? 'KCL Migration' : 'Migrate to KCL 3'}
      </button>
      <Dialog
        open={open}
        onClose={() => {
          if (!writing) setOpen(false)
        }}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/40" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-3xl max-h-[90vh] overflow-auto rounded border border-chalkboard-30 bg-chalkboard-10 p-6 text-chalkboard-100 shadow-xl dark:border-chalkboard-70 dark:bg-chalkboard-90 dark:text-chalkboard-10">
            <Dialog.Title className="text-lg font-semibold">
              Migrate Project to KCL 3 Preview
            </Dialog.Title>
            <Dialog.Description className="my-3 text-sm">
              Free project conversion, with up to 20 minutes for conversion and
              validation. Review the changes before applying. Your original
              stays unchanged until you apply.
            </Dialog.Description>
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
                      <p className="text-sm">
                        Diff shortened. Download the candidate to inspect the
                        complete file.
                      </p>
                    )}
                  </details>
                ))}
              </>
            )}
            <div className="mt-5 flex flex-wrap gap-3 text-sm [&>button]:rounded [&>button]:border [&>button]:border-chalkboard-40 [&>button]:px-3 [&>button]:py-1.5 [&>button:disabled]:opacity-50">
              {['idle', 'failed', 'cancelled'].includes(phase) && (
                <button
                  type="button"
                  disabled={!enabled || !sourceIsKcl2 || !consent}
                  onClick={() => {
                    void controller.start(consent)
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
                  disabled={!enabled}
                  onClick={() => {
                    void controller.apply()
                  }}
                >
                  Apply Migration
                </button>
              )}
              {phase === 'applied' && (
                <button
                  type="button"
                  onClick={() => {
                    void controller.undo()
                  }}
                >
                  Undo Migration
                </button>
              )}
              {original && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    downloadProject(original, 'original-project.zip').catch(
                      reportRejection
                    )
                  }}
                >
                  Download Original
                </button>
              )}
              {candidate && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    downloadProject(candidate, 'migrated-project.zip').catch(
                      reportRejection
                    )
                  }}
                >
                  Download Candidate
                </button>
              )}
              <button
                type="button"
                disabled={writing}
                onClick={() => setOpen(false)}
              >
                {busy ? 'Hide' : 'Close'}
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  )
}
