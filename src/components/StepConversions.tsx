import { Dialog } from '@headlessui/react'
import { useApp } from '@src/lib/boot'
import fsZds from '@src/lib/fs-zds'
import { PATHS, webSafePathSplit } from '@src/lib/paths'
import {
  type StepConversion,
  stepConversions,
  validateConversionFiles,
} from '@src/lib/stepConversion'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'

export function StepConversionDialog(props: {
  source: File
  projectPath: string
  onClose: () => void
}) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const panel = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open
      initialFocus={panel}
      onClose={() => {
        if (!starting) props.onClose()
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <Dialog.Panel
        ref={panel}
        tabIndex={-1}
        className="max-w-md rounded bg-chalkboard-10 p-6 shadow-lg dark:bg-chalkboard-90"
      >
        <Dialog.Title className="text-lg font-semibold">
          Convert file to editable KCL
        </Dialog.Title>
        <p className="my-3 break-all">{props.source.name}</p>
        <p>
          Conversion uses Zookeeper reasoning credits. Check the resulting
          geometry and parameter edits before using it.
        </p>
        <p className="my-3">
          You can keep working while conversion runs. Keep ZDS open; if it
          closes or the connection fails, you can retry from the saved source.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={props.onClose} disabled={starting}>
            Cancel
          </button>
          <button
            type="button"
            disabled={starting}
            onClick={() => {
              setStarting(true)
              void stepConversions
                .enqueue(props.projectPath, props.source)
                .then(props.onClose)
                .catch((reason: unknown) => {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : 'Could not start conversion.'
                  )
                  setStarting(false)
                })
            }}
          >
            {starting ? 'Saving source…' : 'Start conversion'}
          </button>
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}

async function saveResult(job: StepConversion): Promise<string> {
  if (job.savedPath) return job.savedPath
  const files = validateConversionFiles(job.files)
  // Each save uses a new folder, including after an interrupted disk write.
  // Existing project files are never replaced by generated output.
  const directory = fsZds.join(
    job.projectPath,
    `converted-${crypto.randomUUID()}`
  )
  await fsZds.mkdir(directory)
  for (const [name, code] of Object.entries(files)) {
    const destination = fsZds.join(directory, ...webSafePathSplit(name))
    await fsZds.mkdir(fsZds.dirname(destination), { recursive: true })
    await fsZds.writeFile(destination, new TextEncoder().encode(code))
  }
  const entrypoint = fsZds.join(directory, 'main.kcl')
  await stepConversions.savePath(job.id, entrypoint)
  return entrypoint
}

/** Mounted at the app root, independent of project/pane navigation. */
export function StepConversions() {
  const { auth } = useApp()
  const token = auth.useToken()
  const user = auth.useUser()
  const navigate = useNavigate()
  const jobs = useSyncExternalStore(
    stepConversions.subscribe,
    stepConversions.getSnapshot
  )
  const [opening, setOpening] = useState<string>()
  const [retrying, setRetrying] = useState<string>()
  useEffect(() => {
    void stepConversions
      .configure(user?.id ?? '', token)
      .catch(() => toast.error('Could not load saved STEP conversions.'))
  }, [user?.id, token])
  useEffect(
    () => () => {
      void stepConversions.configure('', '')
    },
    []
  )
  if (!jobs.length) return null
  const active = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running'
  ).length
  return (
    <details
      className="fixed bottom-10 right-3 z-40 max-h-[60vh] w-80 overflow-auto rounded border border-chalkboard-40 bg-chalkboard-10 p-3 shadow-lg dark:bg-chalkboard-90"
      open
    >
      <summary className="cursor-pointer font-semibold">
        STEP conversions{active ? ` (${active} active)` : ''}
      </summary>
      <ul className="mt-2 flex flex-col gap-4">
        {jobs.map((job) => (
          <li key={job.id}>
            <p className="truncate" title={job.source.name}>
              {job.source.name}
            </p>
            <p role="status" className="capitalize">
              {job.status}
            </p>
            {job.error && (
              <p className="text-sm" role="alert">
                {job.error}
              </p>
            )}
            {job.status === 'completed' && (
              <>
                <p className="text-sm">Check geometry and parameter edits.</p>
                {job.summary && (
                  <details>
                    <summary>Conversion notes</summary>
                    <p className="whitespace-pre-wrap text-sm">{job.summary}</p>
                  </details>
                )}
                <button
                  type="button"
                  disabled={opening === job.id}
                  onClick={() => {
                    setOpening(job.id)
                    void saveResult(job)
                      .then((path) =>
                        navigate(`${PATHS.FILE}/${encodeURIComponent(path)}`)
                      )
                      .catch(() =>
                        toast.error(
                          'Could not save or open the result. The conversion is retained; try opening it again.'
                        )
                      )
                      .finally(() => setOpening(undefined))
                  }}
                >
                  {opening === job.id ? 'Opening…' : 'Open KCL'}
                </button>
              </>
            )}
            {job.status === 'failed' && (
              <>
                {retrying === job.id ? (
                  <div>
                    <p className="text-sm">
                      This starts a new attempt and uses reasoning credits.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setRetrying(undefined)
                        void stepConversions
                          .retry(job.id)
                          .catch(() =>
                            toast.error('Could not queue the retry.')
                          )
                      }}
                    >
                      Retry conversion
                    </button>
                    <button
                      type="button"
                      className="ml-3"
                      onClick={() => setRetrying(undefined)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setRetrying(job.id)}>
                    Retry…
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}
