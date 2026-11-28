import { Combobox, Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { ActionButton } from '@src/components/ActionButton'
import { CustomIcon } from '@src/components/CustomIcon'
import { noAutofillInputProps } from '@src/lib/autofill'
import {
  FactoryProgress,
  type FactoryFormStep,
} from '@src/lib/factory/FactoryProgress'
import {
  emptyShipping,
  shippingFromAddress,
  type FactoryShippingForm,
} from '@src/lib/factory/api'
import {
  parseFactoryPart,
  type FactoryPart,
  type FactoryWorkspace,
  type SubmittedFactoryJob,
} from '@src/lib/factory/jobs'
import type { FactoryCatalog, FactoryFormContext } from '@src/lib/factory/types'
import { createFactoryFormSession } from '@src/lib/factory/formSession'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import Fuse from 'fuse.js'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

const inputClass =
  'mt-2 w-full rounded border b-4/80 bg-1/90 px-2.5 py-2 text-sm font-normal normal-case tracking-normal text-1 placeholder:text-3 focus:outline-none focus-visible:outline-appForeground dark:bg-2/80'
const labelClass =
  'block text-xs font-medium uppercase tracking-[0.14em] text-2'
const primaryButtonClass =
  'bg-primary !py-0 text-white hover:bg-primary/90 dark:bg-primary dark:text-white dark:hover:bg-primary/90'
const plainIcon = '!bg-transparent dark:!bg-transparent'
const newPart = (entrypoint: string): FactoryPart => ({
  entrypoint,
  material: '',
  finish: '',
  quantity: 1,
  notes: '',
})
type Catalog = FactoryCatalog

export function FactoryButton({
  context,
  workspace,
}: {
  context: FactoryFormContext
  workspace: FactoryWorkspace
}) {
  useSignals()
  const count = workspace.jobs.value.length
  return (
    <Popover className="relative flex">
      {({ open }) => (
        <>
          <Popover.Button
            as={ActionButton}
            Element="button"
            tabIndex={0}
            aria-label={`Submit to Factory${count > 0 ? ` (${count})` : ''}`}
            iconStart={{ icon: 'toolpath', bgClassName: plainIcon }}
            className="relative inline-flex min-w-max !gap-1 !rounded !py-0 !pl-0.5 !pr-2 bg-1/80 hover:bg-1 focus-visible:outline-appForeground active:border-primary dark:!bg-1/50 dark:hover:!bg-1"
            data-testid="factory-button"
          >
            Submit to Factory
            {count > 0 && ` (${count})`}
          </Popover.Button>
          <FactoryPopover context={context} workspace={workspace} open={open} />
        </>
      )}
    </Popover>
  )
}

function FactoryPopover({
  context,
  workspace,
  open,
}: {
  context: FactoryFormContext
  workspace: FactoryWorkspace
  open: boolean
}) {
  useSignals()
  const { local, signedIn, ready, requests } = context
  const formId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [catalog, setCatalog] = useState<Catalog>()
  const [paths, setPaths] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [parts, setParts] = useState<FactoryPart[]>([])
  const [shipping, setShipping] = useState<FactoryShippingForm>({
    ...emptyShipping,
  })
  const [step, setStep] = useState<FactoryFormStep | 'jobs'>(() =>
    workspace.jobs.peek().length ? 'jobs' : 'files'
  )
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [step])
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [session] = useState(() => createFactoryFormSession(workspace))
  const loaded = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const isCurrent = () => alive.current && context.isCurrent()
  useEffect(() => {
    if (!open || !signedIn || !ready) return
    let cancelled = false
    setLoadError('')
    void context
      .load()
      .then(({ catalog, paths }) => {
        if (cancelled) return
        setCatalog(catalog)
        setPaths(paths)
        if (!loaded.current) setShipping(catalog.shipping)
        loaded.current = true
        if (!session.snapshotCaptured.peek())
          setSelected((current) =>
            current.filter((path) => paths.includes(path))
          )
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Factory options could not be loaded.'
          )
      })
    return () => {
      cancelled = true
    }
  }, [context, open, signedIn, ready, attempt, session])
  useEffect(() => {
    if (!loaded.current || session.snapshotCaptured.peek()) return
    if (parts.some((part) => !paths.includes(part.entrypoint))) {
      setParts(parts.filter((part) => paths.includes(part.entrypoint)))
      setStep('files')
      setError(
        'Some part files are no longer available. Review your selection.'
      )
    }
  }, [parts, paths, session])
  const busy = session.pending.value || workspace.pending.value
  const showNavigation = step !== 'jobs' && signedIn && Boolean(catalog)
  const errorMessage = error || session.error.value || workspace.error.value
  const submitLabel = busy
    ? 'Submitting...'
    : step === 'review'
      ? `Submit ${parts.length} ${parts.length === 1 ? 'Job' : 'Jobs'}`
      : 'Next'
  const refresh = () => setAttempt((value) => value + 1)
  const submit = async () => {
    setError('')
    const remaining = await session.submit(context, parts, shipping, isCurrent)
    if (!remaining || !isCurrent()) return
    setParts([...remaining])
    setSelected(remaining.map((part) => part.entrypoint))
    if (!remaining.length) setStep('jobs')
    else if (!workspace.uncertain.peek()) refresh()
  }
  const next = () => {
    setError('')
    if (step === 'files') {
      if (!selected.length) {
        setError('Choose at least one part file.')
        return
      }
      setParts(
        selected.map(
          (path) =>
            parts.find((part) => part.entrypoint === path) ?? newPart(path)
        )
      )
      setStep('parts')
    } else if (step === 'parts') {
      for (const part of parts) {
        const parsed = parseFactoryPart(part)
        if (parsed instanceof Error) {
          setError(parsed.message)
          return
        }
      }
      setStep('shipping')
    } else if (step === 'shipping') setStep('review')
    else if (step === 'review') void submit()
  }
  return (
    <Popover.Panel
      static
      hidden={!open}
      className={`fixed right-4 top-16 z-20 max-h-[calc(100dvh-5rem)] w-[30rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border b-4/80 bg-1/95 text-sm text-1 shadow-2xl backdrop-blur-sm dark:bg-2/95 ${open ? 'flex' : 'hidden'}`}
      role="dialog"
      aria-label="Submit to Factory"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b b-5/70 bg-2/70 px-4 py-4 dark:bg-3/40">
        <div className="min-w-0">
          <h2 className="text-base font-medium leading-none">
            Submit to Factory
          </h2>
          <p className="mt-2 text-xs leading-5 text-2">
            Request manufacturing for your project files.
          </p>
        </div>
        <Popover.Button
          as={ActionButton}
          Element="button"
          tabIndex={0}
          aria-label="Close Factory"
          title="Close"
          iconStart={{ icon: 'close', bgClassName: plainIcon }}
          className="shrink-0 !border-transparent !bg-transparent !px-1 py-1 hover:!bg-3/50"
        />
      </div>
      <div
        ref={bodyRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        {workspace.jobs.value.length > 0 && (
          <section aria-label="Submitted Factory jobs" className="space-y-2">
            {workspace.jobs.value.map((job) => (
              <FactoryJobEditor
                key={job.id}
                job={job}
                catalog={catalog}
                workspace={workspace}
                requests={requests}
                onRejected={refresh}
              />
            ))}
          </section>
        )}
        {step === 'jobs' ? (
          <ActionButton
            Element="button"
            tabIndex={0}
            iconStart={{ icon: 'plus', bgClassName: plainIcon }}
            aria-label="Add Job"
            type="button"
            className="self-end !gap-1 !py-0 !pl-0.5 !pr-2"
            onClick={() => {
              setParts([])
              setSelected([])
              setStep('files')
              refresh()
            }}
          >
            Add Job
          </ActionButton>
        ) : (
          <>
            <FactoryProgress step={step} />
            {!signedIn ? (
              <p>Sign in to submit manufacturing jobs.</p>
            ) : !catalog ? (
              <div role={loadError ? 'alert' : 'status'}>
                {loadError || 'Loading Factory options...'}
                {loadError && (
                  <ActionButton
                    Element="button"
                    tabIndex={0}
                    type="button"
                    className="mt-3 min-h-6 !py-0 !pl-2 !pr-2"
                    onClick={() => setAttempt(attempt + 1)}
                  >
                    Try Again
                  </ActionButton>
                )}
              </div>
            ) : (
              <form
                id={formId}
                onSubmit={(event) => {
                  event.preventDefault()
                  next()
                }}
              >
                <fieldset
                  disabled={busy || workspace.uncertain.value}
                  className="space-y-5"
                >
                  {step === 'files' && (
                    <>
                      <p className="text-xs leading-5 text-2">
                        Select the KCL or STEP file for each part you want
                        manufactured. Each file creates a separate job and
                        should contain a single solid body.
                      </p>
                      <FactoryFilePicker
                        paths={paths}
                        selected={selected}
                        onChange={setSelected}
                      />
                      {local && (
                        <p role="note" className="rounded border b-4 bg-2 p-3">
                          Submitting will duplicate this project into a cloud
                          library. The local project will remain available.
                        </p>
                      )}
                    </>
                  )}
                  {step === 'parts' &&
                    parts.map((part, index) => (
                      <fieldset
                        key={part.entrypoint}
                        className="min-w-0 rounded-lg border b-4/70 bg-1/50 px-4 pb-4"
                      >
                        <legend className="max-w-full px-1 py-2">
                          <span className="flex items-center gap-2 text-sm font-semibold text-1">
                            <span
                              aria-hidden="true"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border b-4 bg-2 text-1"
                            >
                              {index + 1}
                            </span>
                            <span className="break-all">
                              <span className="sr-only">Job {index + 1}: </span>
                              {part.entrypoint}
                            </span>
                          </span>
                        </legend>
                        <PartFields
                          part={part}
                          catalog={catalog}
                          onChange={(next) =>
                            setParts(
                              parts.map((value, i) =>
                                i === index ? next : value
                              )
                            )
                          }
                        />
                      </fieldset>
                    ))}
                  {step === 'shipping' && (
                    <>
                      <p>
                        All jobs in this submission use the same delivery
                        address. Shipping is currently available within the
                        United States.
                      </p>
                      {catalog.addresses.length > 0 && (
                        <label className={labelClass}>
                          Saved address
                          <select
                            className={inputClass}
                            defaultValue=""
                            onChange={(event) => {
                              const address = catalog.addresses.find(
                                (item) => item.id === event.target.value
                              )
                              if (address)
                                setShipping({
                                  ...shippingFromAddress(address),
                                  is_expedited: shipping.is_expedited,
                                })
                            }}
                          >
                            <option value="" disabled>
                              Choose an address
                            </option>
                            {catalog.addresses.map((address) => (
                              <option key={address.id} value={address.id}>
                                {address.label || address.postal.street1}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <ShippingFields value={shipping} onChange={setShipping} />
                    </>
                  )}
                  {step === 'review' && (
                    <>
                      <ul className="space-y-2">
                        {parts.map((part) => (
                          <li
                            key={part.entrypoint}
                            className="rounded border b-4 p-2"
                          >
                            <strong className="break-all">
                              {part.entrypoint}
                            </strong>
                            <p>
                              {part.quantity} x {part.material}, {part.finish}
                            </p>
                            {part.notes && (
                              <p className="whitespace-pre-wrap">
                                {part.notes}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p>
                        {shipping.name}, {shipping.street1}, {shipping.city},{' '}
                        {shipping.state} {shipping.postal_code}, US
                        {shipping.is_expedited && ' (expedited)'}
                      </p>
                      {local && !session.snapshotCaptured.value && (
                        <p>
                          This project will be duplicated into a cloud library.
                        </p>
                      )}
                      <p>
                        By submitting, you agree to the{' '}
                        <a
                          className="underline"
                          href={withSiteBaseURL(
                            '/terms-and-conditions#manufacturing-terms-of-use'
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Manufacturing Terms of Use
                        </a>
                        .
                      </p>
                    </>
                  )}
                </fieldset>
              </form>
            )}
          </>
        )}
      </div>
      {(showNavigation || errorMessage || workspace.uncertain.value) && (
        <div className="shrink-0 border-t b-5/70 bg-1/95 px-4 py-3 dark:bg-2/95">
          {errorMessage && (
            <p role="alert" className="mb-3">
              {errorMessage}
            </p>
          )}
          {workspace.uncertain.value && (
            <a
              className="mb-3 block underline"
              href={withSiteBaseURL('/account/manufacturing')}
              target="_blank"
              rel="noreferrer"
            >
              Check Manufacturing Jobs on zoo.dev
            </a>
          )}

          {showNavigation && (
            <fieldset
              aria-label="Factory form navigation"
              disabled={busy || workspace.uncertain.value}
              className="flex min-w-0 items-center justify-end gap-2"
            >
              {step !== 'files' && (
                <ActionButton
                  Element="button"
                  tabIndex={0}
                  iconStart={{
                    icon: 'arrowLeft',
                    bgClassName: plainIcon,
                  }}
                  type="button"
                  aria-label="Previous"
                  className="mr-auto !gap-1 !py-0 !pl-0.5 !pr-2"
                  disabled={session.snapshotCaptured.value && step === 'parts'}
                  onClick={() =>
                    setStep(
                      step === 'review'
                        ? 'shipping'
                        : step === 'shipping'
                          ? 'parts'
                          : 'files'
                    )
                  }
                >
                  Previous
                </ActionButton>
              )}
              <ActionButton
                Element="button"
                type="submit"
                form={formId}
                tabIndex={0}
                className={`${primaryButtonClass} !gap-1 !pl-2 !pr-0.5`}
                aria-label={submitLabel}
                iconEnd={{
                  icon: 'arrowRight',
                  bgClassName: plainIcon,
                }}
              >
                {submitLabel}
              </ActionButton>
            </fieldset>
          )}
        </div>
      )}
    </Popover.Panel>
  )
}

export function FactoryFilePicker({
  paths,
  selected,
  onChange,
}: {
  paths: string[]
  selected: string[]
  onChange: (paths: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const fuse = useMemo(() => new Fuse(paths, { threshold: 0.3 }), [paths])
  const filtered = query ? fuse.search(query).map((item) => item.item) : paths
  return (
    <Combobox multiple value={selected} onChange={onChange}>
      <Combobox.Label className="sr-only">Part files</Combobox.Label>
      <div className="group flex items-center gap-2 rounded border b-4/80 bg-1/60 py-1.5 pl-2.5 pr-1.5 focus-within:border-primary">
        <Combobox.Input
          {...noAutofillInputProps}
          className="w-full min-w-0 bg-transparent focus:outline-none selection:bg-primary/20"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search part files"
        />
        <CustomIcon
          name="search"
          aria-hidden="true"
          className="h-5 w-5 shrink-0 rounded-sm bg-primary/10 text-primary group-focus-within:bg-primary group-focus-within:text-white"
        />
      </div>
      <Combobox.Options
        static
        className="mt-3 max-h-52 overflow-y-auto overscroll-contain rounded-lg border b-5/80 bg-1/70 p-1.5"
      >
        {filtered.map((path) => (
          <Combobox.Option
            key={path}
            value={path}
            className={({ active, selected }) =>
              `flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5 transition-colors ${active ? 'bg-3/60' : selected ? 'bg-primary/10' : 'hover:bg-2/60'}`
            }
          >
            {({ selected }) => (
              <>
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${selected ? 'border-primary bg-primary text-white' : 'b-4 bg-1'}`}
                >
                  {selected && (
                    <CustomIcon name="checkmark" className="h-3 w-3" />
                  )}
                </span>
                <span className="break-all font-mono text-xs">{path}</span>
              </>
            )}
          </Combobox.Option>
        ))}
        {!filtered.length && (
          <li className="p-2 text-2">No matching KCL or STEP files.</li>
        )}
      </Combobox.Options>
      <p className="mt-2 text-xs text-2" aria-live="polite">
        {selected.length} {selected.length === 1 ? 'file' : 'files'} selected
      </p>
    </Combobox>
  )
}

export function PartFields({
  part,
  catalog,
  onChange,
}: {
  part: FactoryPart
  catalog: Pick<Catalog, 'materials' | 'finishes'>
  onChange: (part: FactoryPart) => void
}) {
  return (
    <div className="space-y-3">
      {(['material', 'finish'] as const).map((field) => (
        <label key={field} className={labelClass}>
          {field === 'material' ? 'Material' : 'Finish'}
          <select
            className={inputClass}
            required
            value={part[field]}
            onChange={(event) =>
              onChange({ ...part, [field]: event.target.value })
            }
          >
            <option value="">Choose {field}</option>
            {catalog[field === 'material' ? 'materials' : 'finishes'].map(
              (name) => (
                <option key={name}>{name}</option>
              )
            )}
          </select>
        </label>
      ))}
      <label className={labelClass}>
        Quantity
        <input
          className={inputClass}
          type="number"
          required
          min="1"
          step="1"
          value={Number.isNaN(part.quantity) ? '' : part.quantity}
          onChange={(event) =>
            onChange({ ...part, quantity: event.target.valueAsNumber })
          }
        />
      </label>
      <label className={labelClass}>
        Notes
        <textarea
          className={inputClass}
          rows={3}
          value={part.notes}
          onChange={(event) => onChange({ ...part, notes: event.target.value })}
        />
      </label>
    </div>
  )
}

function ShippingFields({
  value,
  onChange,
}: {
  value: FactoryShippingForm
  onChange: (value: FactoryShippingForm) => void
}) {
  const fields: {
    key: Exclude<keyof FactoryShippingForm, 'is_expedited' | 'country'>
    label: string
    required?: boolean
  }[] = [
    { key: 'name', label: 'Recipient', required: true },
    { key: 'company', label: 'Company' },
    { key: 'phone', label: 'Phone', required: true },
    { key: 'street1', label: 'Street address', required: true },
    { key: 'street2', label: 'Address line 2' },
    { key: 'city', label: 'City', required: true },
    { key: 'state', label: 'State', required: true },
    { key: 'postal_code', label: 'ZIP code', required: true },
  ]
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(({ key, label, required }) => (
        <label className={labelClass} key={key}>
          {label}
          <input
            className={inputClass}
            required={required}
            type={key === 'phone' ? 'tel' : 'text'}
            value={value[key]}
            onChange={(event) =>
              onChange({ ...value, [key]: event.target.value })
            }
          />
        </label>
      ))}
      <label className="col-span-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={value.is_expedited}
          onChange={(event) =>
            onChange({ ...value, is_expedited: event.target.checked })
          }
        />
        Request expedited delivery
      </label>
    </div>
  )
}

function FactoryJobEditor({
  job,
  catalog,
  workspace,
  requests,
  onRejected,
}: {
  job: SubmittedFactoryJob
  catalog: Catalog | undefined
  workspace: FactoryWorkspace
  requests: FactoryFormContext['requests']
  onRejected: () => void
}) {
  useSignals()
  const [part, setPart] = useState(job.part)
  const [saved, setSaved] = useState(false)
  const revisable = ['new', 'quoting', 'waiting_on_customer'].includes(
    job.status
  )
  return (
    <details className="rounded border b-4 p-3">
      <summary className="cursor-pointer break-all">
        {job.part.entrypoint} <span className="text-2">({job.status})</span>
      </summary>
      <a
        className="my-3 block underline"
        href={withSiteBaseURL(
          `/account/manufacturing?job=${encodeURIComponent(job.id)}`
        )}
        target="_blank"
        rel="noreferrer"
      >
        View job on zoo.dev
      </a>
      <p className="mb-3 text-2">
        Edits submit a new revision using the files already submitted. Jobs
        cannot be revised after quote acceptance.
      </p>
      {catalog && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(false)
            void workspace.revise(job, part, requests).then((saved) => {
              setSaved(saved)
              if (!saved && !workspace.uncertain.peek()) onRejected()
            })
          }}
        >
          <fieldset
            disabled={
              !revisable || workspace.pending.value || workspace.uncertain.value
            }
          >
            <PartFields part={part} catalog={catalog} onChange={setPart} />
            <ActionButton
              Element="button"
              tabIndex={0}
              iconStart={{ icon: 'checkmark', bgClassName: plainIcon }}
              className={`${primaryButtonClass} mt-4 ml-auto !gap-1 !pl-0.5 !pr-2`}
              aria-label="Submit Revision"
              type="submit"
            >
              Submit Revision
            </ActionButton>
          </fieldset>
          {saved && <p role="status">Revision submitted.</p>}
        </form>
      )}
    </details>
  )
}
