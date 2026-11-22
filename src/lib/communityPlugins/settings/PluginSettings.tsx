import { useSignals } from '@preact/signals-react/runtime'
import { useState } from 'react'
import type { SettingDefinition, SettingValue } from '@zoo/zds-plugin'
import type {
  InstalledPlugin,
  PluginInstallations,
} from '@src/lib/communityPlugins/installations'
import {
  acceptsSettingValue,
  settingValue,
} from '@src/lib/communityPlugins/settings/schema'
import { reportRejection } from '@src/lib/trap'

/** The existing Plugins panel hosts these controls until the settings page editor consumes the same metadata. */
export function PluginSettings({
  entry,
  manager,
  busy,
}: {
  entry: InstalledPlugin
  manager: PluginInstallations
  busy: boolean
}) {
  useSignals()
  const page = entry.settingsPage.value
  if (!page || !entry.installation.enabled) return null
  const values = entry.settingsValues.value
  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-label={`${page.title} settings`}
    >
      <legend>User settings</legend>
      {Object.entries(page.fields).map(([key, field]) => {
        const value = settingValue(field, key, values)
        const overridden = Object.hasOwn(values, key)
        return (
          <SettingField
            key={`${page.id}.${key}:${JSON.stringify(field)}:${JSON.stringify(value)}`}
            id={`${page.id}.${key}`}
            field={field}
            value={value}
            overridden={overridden}
            incompatible={
              overridden && !acceptsSettingValue(field, values[key])
            }
            busy={busy}
            save={(value) =>
              manager.setSetting(entry.installation.id, key, value)
            }
            reset={() => manager.resetSetting(entry.installation.id, key)}
          />
        )
      })}
      <button
        type="button"
        disabled={busy || Object.keys(values).length === 0}
        onClick={() => {
          void manager
            .resetSetting(entry.installation.id)
            .catch(reportRejection)
        }}
      >
        Reset plugin settings
      </button>
    </fieldset>
  )
}

function SettingField({
  id,
  field,
  value,
  overridden,
  incompatible,
  busy,
  save,
  reset,
}: {
  id: string
  field: SettingDefinition
  value: SettingValue
  overridden: boolean
  incompatible: boolean
  busy: boolean
  save: (value: SettingValue) => Promise<Error | undefined>
  reset: () => Promise<Error | undefined>
}) {
  const [draft, setDraft] = useState<string | boolean>(
    field.type === 'boolean' ? value === true : String(value)
  )
  const [error, setError] = useState<Error>()
  const commit = async () => {
    const parsed =
      field.type === 'number'
        ? typeof draft === 'string' && draft.trim()
          ? Number(draft)
          : NaN
        : draft
    if (!acceptsSettingValue(field, parsed)) {
      setError(new Error('Enter a value matching this setting and its limits.'))
      return
    }
    setError(await save(parsed))
  }
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={`${field.title} setting`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void commit().catch(reportRejection)
      }}
    >
      <label htmlFor={id}>{field.title}</label>
      {field.description && (
        <p id={`${id}.description`} className="text-2 text-sm">
          {field.description}
        </p>
      )}
      {field.type === 'boolean' ? (
        <input
          id={id}
          type="checkbox"
          checked={draft === true}
          disabled={busy}
          aria-describedby={field.description ? `${id}.description` : undefined}
          onChange={(event) => setDraft(event.target.checked)}
        />
      ) : (
        <input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          step={field.type === 'number' ? 'any' : undefined}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          maxLength={
            field.type === 'string' ? (field.maxLength ?? 4000) : undefined
          }
          value={typeof draft === 'string' ? draft : ''}
          disabled={busy}
          aria-describedby={field.description ? `${id}.description` : undefined}
          className="rounded border b-4 bg-default px-2 py-1 text-default"
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {incompatible && (
        <p role="status">
          The saved value is incompatible with this definition. The default is
          shown; the saved value is retained until reset or replaced.
        </p>
      )}
      {error && <p role="alert">{error.message}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy}>
          Save {field.title}
        </button>
        <button
          type="button"
          disabled={busy || !overridden}
          onClick={() => {
            void reset().then(setError).catch(reportRejection)
          }}
        >
          Reset {field.title}
        </button>
      </div>
    </form>
  )
}
