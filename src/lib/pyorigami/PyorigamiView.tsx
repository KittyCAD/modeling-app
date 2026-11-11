import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Editor } from '@src/lib/editors/registry/contract'
import type { Executor } from '@src/lib/executors/registry/contract'
import { ImageCanvas } from '@src/lib/imageCanvas/ImageCanvas'
import type { PyorigamiAuthoringService } from '@src/lib/pyorigami/authoring'
import type {
  AuthoringField,
  AuthoringOperation,
} from '@src/lib/pyorigami/authoringTypes'
import { pyorigamiExecutorCapability } from '@src/lib/pyorigami/executor'
import { reportRejection } from '@src/lib/trap'
import styles from './PyorigamiView.module.css'

const propertyLabels = {
  title: 'Title',
  designer: 'Designer',
  diagrammer: 'Diagrammer',
  colorFront: 'Front color',
  colorBack: 'Back color',
}
function fieldId(field: AuthoringField) {
  const target = field.target
  return target.kind === 'property'
    ? target.property
    : `caption:${target.step}:${target.caption}`
}
function fieldLabel(field: AuthoringField) {
  const target = field.target
  return target.kind === 'property'
    ? propertyLabels[target.property]
    : `Step ${target.step + 1} caption ${target.caption + 1}`
}

/** Each field is an activation region until focus creates a local, uncommitted text draft. */
function InlineField({
  field,
  source,
  available,
  commit,
  suppressBlur,
}: {
  field: AuthoringField
  source: string
  available: boolean
  commit: (
    source: string,
    operation: AuthoringOperation
  ) => Promise<Error | undefined>
  suppressBlur: { current: boolean }
}) {
  const [draft, setDraft] = useState<{
    value: string
    initial: string
    source: string
  }>()
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const active = Boolean(draft)
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true })
  }, [active])
  const saving = useRef(false)
  const cancelled = useRef(false)
  const label = fieldLabel(field)
  const activate = () => {
    if (available && field.editable) {
      cancelled.current = false
      setDraft({ value: field.value, initial: field.value, source })
    }
  }
  const save = async () => {
    if (!draft || saving.current || cancelled.current || suppressBlur.current)
      return
    if (draft.value === draft.initial) {
      setDraft(undefined)
      return
    }
    saving.current = true
    const result = await commit(draft.source, {
      ...field.target,
      value: draft.value,
    })
    saving.current = false
    if (result) setError(result.message)
    else {
      setError(undefined)
      setDraft(undefined)
    }
  }
  return (
    <div
      className={`${styles.field} ${field.target.kind === 'property' && field.target.property === 'title' ? styles.title : ''} ${!field.value && (field.target.kind === 'caption' || (field.target.kind === 'property' && field.target.property.startsWith('color'))) ? styles.empty : ''}`}
      style={{
        left: `${field.x * 100}%`,
        top: `${field.y * 100}%`,
        width: `${field.width * 100}%`,
        height: `${field.height * 100}%`,
      }}
    >
      {draft ? (
        <input
          aria-label={label}
          aria-invalid={Boolean(error)}
          title={
            error ??
            (field.target.kind === 'property' &&
            field.target.property.startsWith('color')
              ? 'Named color or RGB percentages, for example 100, 80, 20'
              : label)
          }
          className={styles.input}
          ref={input}
          value={draft.value}
          onChange={(event) =>
            setDraft({ ...draft, value: event.target.value })
          }
          onBlur={() => {
            void save().catch(reportRejection)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void save().catch(reportRejection)
              event.currentTarget
                .closest<HTMLElement>('[data-pyorigami-editor]')
                ?.focus({ preventScroll: true })
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancelled.current = true
              event.currentTarget
                .closest<HTMLElement>('[data-pyorigami-editor]')
                ?.focus({ preventScroll: true })
              setDraft(undefined)
              setError(undefined)
            }
          }}
        />
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-disabled={!available || !field.editable}
          title={
            field.editable
              ? `Edit ${label.toLowerCase()}`
              : 'This value is computed. Edit it in Code mode.'
          }
          className={styles.activate}
          onFocus={activate}
          onClick={activate}
        >
          <span className={styles.placeholder}>
            {field.value || `Add ${label.toLowerCase()}`}
          </span>
        </button>
      )}
      {error && (
        <p role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
    </div>
  )
}

/** The source snapshot owns hit regions; this presentation owns drafts, navigation, and its edit queue. */
export function PyorigamiView({
  executor,
  editor,
  authoring,
  signal,
}: {
  executor: Executor
  editor: Editor
  authoring: PyorigamiAuthoringService
  signal: AbortSignal
}) {
  useSignals()
  const output = executor.output.value
  const data = output.get(pyorigamiExecutorCapability)
  const [display, setDisplay] = useState<{
    contents: string
    data: NonNullable<typeof data>
  }>()
  if (data && !output.running && display?.data !== data)
    setDisplay({ contents: output.contents, data })
  const snapshot =
    data && !output.running ? { contents: output.contents, data } : display
  const error = output.errors[pyorigamiExecutorCapability.id]
  const [selectedPage, setSelectedPage] = useState(0)
  const [pending, setPending] = useState(0)
  const [editError, setEditError] = useState<string>()
  const [historyEpoch, setHistoryEpoch] = useState(0)
  const suppressBlur = useRef(false)
  const queue = useRef<Promise<Error | undefined>>(Promise.resolve(undefined))
  const operationEpoch = useRef(0)
  const activeOperation = useRef<AbortController | undefined>(undefined)
  const authoredSources = useRef(new Set<string>())
  const pages = snapshot?.data.pages
  const page = Math.min(selectedPage, Math.max(0, (pages?.length ?? 1) - 1))
  const svg = pages?.[page]
  const blob = useMemo(
    () =>
      svg === undefined
        ? undefined
        : new Blob([svg], { type: 'image/svg+xml' }),
    [svg]
  )
  const model = snapshot?.data.authoring
  const currentSource = editor.contents.value
  const available = Boolean(
    snapshot &&
      (snapshot.contents === currentSource ||
        authoredSources.current.has(currentSource))
  )
  const commit = (source: string, operation: AuthoringOperation) => {
    setPending((count) => count + 1)
    const epoch = operationEpoch.current
    const request = queue.current
      .then(async () => {
        if (epoch !== operationEpoch.current)
          return new Error('Origami authoring was cancelled.')
        const current = editor.contents.peek()
        // These operations only change properties/captions or append steps. Their
        // semantic targets survive earlier edits in this queue, never arbitrary Code edits.
        const rebased =
          source !== current &&
          authoredSources.current.has(source) &&
          authoredSources.current.has(current)
        if (source !== current && !rebased)
          return new Error(
            'The source changed. Wait for its preview before editing.'
          )
        const controller = new AbortController()
        activeOperation.current = controller
        const cancel = () => controller.abort()
        signal.addEventListener('abort', cancel, { once: true })
        if (signal.aborted) cancel()
        try {
          const result = await authoring.apply(
            editor,
            current,
            operation,
            controller.signal
          )
          if (!result) {
            authoredSources.current.add(source)
            authoredSources.current.add(editor.contents.peek())
          }
          return result
        } finally {
          signal.removeEventListener('abort', cancel)
          if (activeOperation.current === controller)
            activeOperation.current = undefined
        }
      })
      .catch((cause) =>
        cause instanceof Error ? cause : new Error(String(cause))
      )
    queue.current = request
    void request
      .finally(() => setPending((count) => count - 1))
      .catch(reportRejection)
    return request
  }
  const history = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key !== 'z' && key !== 'y') return
    event.preventDefault()
    event.stopPropagation()
    suppressBlur.current = true
    operationEpoch.current++
    activeOperation.current?.abort()
    setEditError(undefined)
    setHistoryEpoch((epoch) => epoch + 1)
    if (key === 'y' || event.shiftKey) editor.redo()
    else editor.undo()
    event.currentTarget.focus({ preventScroll: true })
    queueMicrotask(() => {
      suppressBlur.current = false
    })
  }
  const addStep = () => {
    if (!snapshot) return
    const epoch = operationEpoch.current
    void commit(snapshot.contents, { kind: 'addStep' })
      .then((result) => {
        if (epoch === operationEpoch.current) setEditError(result?.message)
      })
      .catch(reportRejection)
  }
  return (
    <section
      data-pyorigami-editor=""
      tabIndex={-1}
      onKeyDownCapture={history}
      onPointerDown={(event) => {
        if (
          event.target instanceof HTMLElement &&
          !event.target.closest('input, button, select, textarea')
        )
          event.currentTarget.focus({ preventScroll: true })
      }}
      aria-label="pyOrigami preview"
      aria-busy={output.running || pending > 0}
      className="relative flex flex-col flex-1 min-h-0 min-w-0 outline-none"
    >
      {(output.running || pending > 0) && (
        <p role="status" className={styles.status}>
          {pending > 0 ? 'Updating diagram...' : 'Rendering pyOrigami...'}
        </p>
      )}
      {(error || editError || model?.error) && (
        <p
          role="alert"
          className="m-0 p-2 text-sm whitespace-pre-wrap overflow-auto"
        >
          {error?.message ?? editError ?? model?.error}
        </p>
      )}
      {blob && (
        <>
          {pages && pages.length > 1 && (
            <label className="p-2 text-sm">
              Page{' '}
              <select
                aria-label="Diagram page"
                value={page}
                onChange={(event) =>
                  setSelectedPage(Number(event.target.value))
                }
              >
                {pages.map((_, index) => (
                  <option key={index} value={index}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ImageCanvas
            key={page}
            preserveView
            blob={blob}
            name={`Origami diagram, page ${page + 1}`}
            background="paper"
            hint="Click text or Tab to edit. Drag to pan, scroll to zoom."
            overlay={
              <div className={styles.overlay}>
                {model?.fields
                  .filter((field) => field.page === page)
                  .map((field) => (
                    <InlineField
                      key={`${fieldId(field)}:${historyEpoch}`}
                      field={field}
                      source={snapshot?.contents ?? ''}
                      available={available}
                      commit={commit}
                      suppressBlur={suppressBlur}
                    />
                  ))}
                {model?.canAddStep && page === (pages?.length ?? 1) - 1 && (
                  <button
                    type="button"
                    className={styles.addStep}
                    disabled={!available}
                    onClick={addStep}
                  >
                    + Add step
                  </button>
                )}
              </div>
            }
          />
        </>
      )}
    </section>
  )
}
