import { Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useId, useRef, useState } from 'react'
import type { TomlTable, TomlValue } from 'smol-toml'
import { SettingsSection } from '@src/components/Settings/SettingsSection'
import type { EditorSave } from '@src/lib/save/registry/contract'
import type { Executor } from '@src/lib/executors/registry/contract'
import {
  editToml,
  type EditableTomlValue,
  type TomlPath,
} from '@src/lib/toml/document'
import { tomlParse, tomlParseOutputKey } from '@src/lib/toml/registry/tomlParse'
import { isErr, reportRejection } from '@src/lib/trap'
import { isArray, isRecord } from '@src/lib/utils'

interface Section {
  path: TomlPath
  title: string
  values: TomlTable
}
const label = (key: string) => key.replaceAll('_', ' ')

/** Sections mirror the document, including plugin and future settings unknown to this UI. */
function sectionsFor(table: TomlTable): Section[] {
  const sections: Section[] = []
  const root: TomlTable = {}
  for (const [key, value] of Object.entries(table)) {
    if (!isRecord(value)) {
      root[key] = value
      continue
    }
    if (key === 'settings') {
      const direct: TomlTable = {}
      for (const [section, child] of Object.entries(value)) {
        if (isRecord(child))
          sections.push({
            path: [key, section],
            title: label(section),
            values: child,
          })
        else direct[section] = child
      }
      if (Object.keys(direct).length)
        sections.push({ path: [key], title: 'Settings', values: direct })
    } else sections.push({ path: [key], title: label(key), values: value })
  }
  if (Object.keys(root).length)
    sections.unshift({ path: [], title: 'Project', values: root })
  return sections
}

type Commit = (path: TomlPath, value: EditableTomlValue) => Error | undefined

function ValueInput({
  value,
  name,
  path,
  commit,
}: {
  value: EditableTomlValue
  name: string
  path: TomlPath
  commit: Commit
}) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<Error>()
  useEffect(() => setDraft(String(value)), [value])
  const id = useId()
  const update = (text: string) => {
    if (text === String(value)) return
    let next: EditableTomlValue = text
    try {
      if (typeof value === 'bigint') next = BigInt(text)
      if (typeof value === 'number') {
        if (!text.trim() || !Number.isFinite(Number(text))) {
          setError(new Error('Enter a number.'))
          return
        }
        next = Number(text)
      }
    } catch {
      setError(new Error('Enter a whole number.'))
      return
    }
    setError(commit(path, next))
  }
  return (
    <div>
      {typeof value === 'boolean' ? (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label={name}
            checked={value}
            onChange={(event) => setError(commit(path, event.target.checked))}
          />
          {value ? 'On' : 'Off'}
        </label>
      ) : typeof value === 'string' && value.includes('\n') ? (
        <textarea
          id={id}
          aria-label={name}
          aria-describedby={error ? id + '-error' : undefined}
          className="w-full rounded border b-4 bg-transparent px-2 py-1 text-sm"
          rows={4}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => update(event.target.value)}
        />
      ) : (
        <input
          id={id}
          aria-label={name}
          aria-describedby={error ? id + '-error' : undefined}
          className="w-full rounded border b-4 bg-transparent px-2 py-1 text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => update(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      )}
      {error && (
        <p id={id + '-error'} role="alert" className="mt-1 text-sm">
          {error.message}
        </p>
      )}
    </div>
  )
}

function Fields({
  values,
  path,
  commit,
}: {
  values: TomlTable | TomlValue[]
  path: TomlPath
  commit: Commit
}) {
  return (
    <>
      {Object.entries(values).map(([key, value]) => {
        const childPath = [...path, isArray(values) ? Number(key) : key]
        const name = isArray(values) ? `Item ${Number(key) + 1}` : label(key)
        if (isArray(value) || isRecord(value))
          return (
            <fieldset key={key} className="my-4 min-w-0 border-l b-4 pl-3">
              <legend className="px-1 text-sm font-medium capitalize">
                {name}
              </legend>
              <Fields values={value} path={childPath} commit={commit} />
              {!Object.keys(value).length && (
                <p className="p-2 text-sm text-2">No entries.</p>
              )}
            </fieldset>
          )
        return (
          <SettingsSection
            key={key}
            title={name}
            headingClassName="text-sm font-normal capitalize"
          >
            {typeof value === 'object' ? (
              <span className="text-sm">{String(value)}</span>
            ) : (
              <ValueInput
                value={value}
                name={name}
                path={childPath}
                commit={commit}
              />
            )}
          </SettingsSection>
        )
      })}
    </>
  )
}

export function SettingsEditor({
  executor,
  saving,
}: {
  executor: Executor
  saving?: EditorSave
}) {
  useSignals()
  const output = executor.output.value
  const error = output.errors[tomlParse.id]
  const table = output.get(tomlParse)?.[tomlParseOutputKey]
  const previous = useRef(table)
  if (table) previous.current = table
  const sections = sectionsFor(table ?? previous.current ?? {})
  const [sectionId, setSectionId] = useState('')
  const selected =
    sections.find((section) => JSON.stringify(section.path) === sectionId) ??
    sections[0]
  const saveState = saving?.state(executor.editor).value
  const [saveError, setSaveError] = useState<Error>()
  const commit: Commit = (path, value) => {
    const editor = executor.editor
    const change = editToml(editor.contents.peek(), path, value)
    if (isErr(change)) return change
    editor.dispatch({
      changes: change,
      annotations: [
        Transaction.userEvent.of('input.settings'),
        isolateHistory.of('full'),
      ],
    })
  }
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between border-b b-4 px-4 py-3">
        <h1 className="font-medium">Project settings</h1>
        {saving && (
          <button
            type="button"
            className="rounded border b-4 px-3 py-1 text-sm"
            disabled={!saveState?.dirty || saveState.saving}
            onClick={() => {
              void saving
                .save(executor.editor)
                .then(setSaveError)
                .catch(reportRejection)
            }}
          >
            {saveState?.saving ? 'Saving...' : 'Save file'}
          </button>
        )}
      </header>
      {(error || saveError || saveState?.error) && (
        <p role="alert" className="p-4 text-sm">
          {(error ?? saveError ?? saveState?.error)?.message}
        </p>
      )}
      {!error && (table || previous.current) ? (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="w-40 shrink-0 overflow-auto border-r b-4 p-2"
          >
            {sections.map((section) => (
              <button
                key={JSON.stringify(section.path)}
                type="button"
                aria-current={section === selected ? 'page' : undefined}
                className={`mb-1 w-full rounded px-3 py-2 text-left text-sm capitalize hover:bg-2 dark:hover:bg-2 ${section === selected ? 'bg-2 dark:bg-2 font-medium' : ''}`}
                onClick={() => setSectionId(JSON.stringify(section.path))}
              >
                {section.title}
              </button>
            ))}
          </nav>
          <main className="min-w-0 flex-1 overflow-auto p-4">
            {selected ? (
              <div className="max-w-3xl">
                <h2 className="mb-4 text-lg capitalize">{selected.title}</h2>
                <Fields
                  key={JSON.stringify(selected.path)}
                  values={selected.values}
                  path={selected.path}
                  commit={commit}
                />
              </div>
            ) : (
              <p className="text-sm">
                No settings yet. Add a section in the TOML source to get
                started.
              </p>
            )}
          </main>
        </div>
      ) : (
        !error && (
          <p role="status" className="p-4">
            Reading settings...
          </p>
        )
      )}
    </div>
  )
}
