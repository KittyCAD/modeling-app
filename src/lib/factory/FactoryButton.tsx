import { Combobox, Popover } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import {
  emptyShipping,
  shippingFromAddress,
  type FactoryShippingForm,
} from '@src/lib/factory/api'
import {
  parseFactoryPart,
  type FactoryDelivery,
  type FactoryPart,
  type FactorySnapshot,
  type FactoryWorkspace,
  type SubmittedFactoryJob,
} from '@src/lib/factory/jobs'
import type { FactoryCatalog, FactoryFormContext } from '@src/lib/factory/types'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import Fuse from 'fuse.js'
import { useEffect, useMemo, useRef, useState } from 'react'

const inputClass = 'w-full rounded border b-4 bg-1 px-2 py-1 text-1'
const buttonClass =
  'rounded border b-4 bg-2 px-3 py-1 text-1 hover:bg-3 disabled:opacity-50'
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
          <Popover.Button className={buttonClass} data-testid="factory-button">
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
  const [catalog, setCatalog] = useState<Catalog>()
  const [paths, setPaths] = useState<string[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [parts, setParts] = useState<FactoryPart[]>([])
  const [shipping, setShipping] = useState<FactoryShippingForm>({
    ...emptyShipping,
  })
  const [step, setStep] = useState<
    'files' | 'parts' | 'shipping' | 'review' | 'jobs'
  >(() => (workspace.jobs.peek().length ? 'jobs' : 'files'))
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [preparing, setPreparing] = useState(false)
  const snapshot = useRef<FactorySnapshot | undefined>(undefined)
  const delivery = useRef<{ key: string; value: FactoryDelivery } | undefined>(
    undefined
  )
  const submissionLock = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const isCurrent = () => alive.current && context.isCurrent()
  useEffect(() => {
    if (!open || !signedIn || !ready || catalog) return
    let cancelled = false
    setLoadError('')
    void context
      .load()
      .then(({ catalog, paths }) => {
        if (cancelled) return
        setCatalog(catalog)
        setPaths(paths)
        setShipping(catalog.shipping)
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
  }, [context, open, signedIn, ready, catalog, attempt])
  const busy = preparing || workspace.pending.value
  const submit = async () => {
    if (
      submissionLock.current ||
      busy ||
      workspace.uncertain.peek() ||
      !isCurrent()
    )
      return
    submissionLock.current = true
    setPreparing(true)
    setError('')
    try {
      const captured = snapshot.current ?? (await context.capture(isCurrent))
      snapshot.current = captured
      if (!isCurrent()) return
      const key = JSON.stringify(shipping)
      const shared =
        delivery.current?.key === key
          ? delivery.current.value
          : await context.saveDelivery(shipping)
      delivery.current = { key, value: shared }
      if (!isCurrent()) return
      const completed = await workspace.submit(
        parts,
        captured,
        shared,
        requests
      )
      if (!isCurrent()) return
      const remaining = parts.filter(
        (part) => !completed.includes(part.entrypoint)
      )
      setParts(remaining)
      setSelected(remaining.map((part) => part.entrypoint))
      if (!remaining.length) {
        setStep('jobs')
        snapshot.current = undefined
        delivery.current = undefined
      }
    } catch (error) {
      if (isCurrent())
        setError(
          error instanceof Error
            ? error.message
            : 'The project could not be submitted.'
        )
    } finally {
      submissionLock.current = false
      if (alive.current) setPreparing(false)
    }
  }
  const next = () => {
    setError('')
    if (step === 'files') {
      if (!selected.length) {
        setError('Choose at least one KCL entry point.')
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
      className="fixed right-4 top-16 z-20 max-h-[calc(100dvh-5rem)] w-[30rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded border b-4 bg-1 p-4 text-sm text-1 shadow-2xl"
      role="dialog"
      aria-label="Submit to Factory"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-medium">Submit to Factory</h2>
        <Popover.Button aria-label="Close Factory">Close</Popover.Button>
      </div>
      {workspace.jobs.value.length > 0 && (
        <section aria-label="Submitted Factory jobs" className="mb-4 space-y-2">
          {workspace.jobs.value.map((job) => (
            <FactoryJobEditor
              key={job.id}
              job={job}
              catalog={catalog}
              workspace={workspace}
              requests={requests}
            />
          ))}
        </section>
      )}
      {step === 'jobs' ? (
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setParts([])
            setSelected([])
            setStep('files')
          }}
        >
          Add Job
        </button>
      ) : (
        <>
          <p className="mb-3 text-2">
            {
              {
                files: '1. Choose entry points',
                parts: '2. Job details',
                shipping: '3. Delivery',
                review: '4. Confirm jobs',
              }[step]
            }
          </p>
          {!signedIn ? (
            <p>Sign in to submit manufacturing jobs.</p>
          ) : !catalog ? (
            <div role={loadError ? 'alert' : 'status'}>
              {loadError || 'Loading Factory options...'}
              {loadError && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setAttempt(attempt + 1)}
                >
                  Try Again
                </button>
              )}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                next()
              }}
            >
              <fieldset
                disabled={busy || workspace.uncertain.value}
                className="space-y-4"
              >
                {step === 'files' && (
                  <>
                    <p>
                      Choose one KCL file per manufacturing job. Each model
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
                      className="rounded border b-4 p-3"
                    >
                      <legend className="break-all px-1">
                        {part.entrypoint}
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
                      All jobs in this submission use the same delivery address.
                      Shipping is currently available within the United States.
                    </p>
                    {catalog.addresses.length > 0 && (
                      <label className="block">
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
                            <p className="whitespace-pre-wrap">{part.notes}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p>
                      {shipping.name}, {shipping.street1}, {shipping.city},{' '}
                      {shipping.state} {shipping.postal_code}, US
                      {shipping.is_expedited && ' (expedited)'}
                    </p>
                    {local && !snapshot.current && (
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
                <div className="flex justify-between gap-2">
                  {step !== 'files' && (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={Boolean(snapshot.current) && step === 'parts'}
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
                      Back
                    </button>
                  )}
                  <button type="submit" className={buttonClass}>
                    {busy
                      ? 'Submitting...'
                      : step === 'review'
                        ? `Submit ${parts.length} ${parts.length === 1 ? 'Job' : 'Jobs'}`
                        : 'Next'}
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </>
      )}
      {(error || workspace.error.value) && (
        <p role="alert" className="mt-3">
          {error || workspace.error.value}
        </p>
      )}
      {workspace.uncertain.value && (
        <a
          className="mt-2 block underline"
          href={withSiteBaseURL('/account/manufacturing')}
          target="_blank"
          rel="noreferrer"
        >
          Check Manufacturing Jobs on zoo.dev
        </a>
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
      <Combobox.Label className="block">Entry point files</Combobox.Label>
      <Combobox.Input
        className={inputClass}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search project files"
      />
      <Combobox.Options
        static
        className="mt-2 max-h-48 overflow-y-auto rounded border b-4"
      >
        {filtered.map((path) => (
          <Combobox.Option
            key={path}
            value={path}
            className={({ active }) =>
              `cursor-pointer break-all px-3 py-2 ${active ? 'bg-3' : 'bg-1'}`
            }
          >
            {({ selected }) => (
              <>
                <span aria-hidden="true">{selected ? '[x] ' : '[ ] '}</span>
                {path}
              </>
            )}
          </Combobox.Option>
        ))}
        {!filtered.length && (
          <li className="p-2 text-2">No matching KCL files.</li>
        )}
      </Combobox.Options>
      <p className="mt-2 text-2">
        {selected.length} selected
        {selected.length > 0 && `: ${selected.join(', ')}`}
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
        <label key={field} className="block">
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
      <label className="block">
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
      <label className="block">
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
        <label className="block" key={key}>
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
}: {
  job: SubmittedFactoryJob
  catalog: Catalog | undefined
  workspace: FactoryWorkspace
  requests: FactoryFormContext['requests']
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
            void workspace.revise(job, part, requests).then(setSaved)
          }}
        >
          <fieldset
            disabled={
              !revisable || workspace.pending.value || workspace.uncertain.value
            }
          >
            <PartFields part={part} catalog={catalog} onChange={setPart} />
            <button className={`${buttonClass} mt-3`} type="submit">
              Submit Revision
            </button>
          </fieldset>
          {saved && <p role="status">Revision submitted.</p>}
        </form>
      )}
    </details>
  )
}
