import { Combobox } from '@headlessui/react'
import { useSignalEffect } from '@preact/signals-react'
import { useSignals } from '@preact/signals-react/runtime'
import { getKeybindingRows } from '@src/components/Settings/keybindingRows'
import Fuse from 'fuse.js'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { CustomIcon } from '@src/components/CustomIcon'
import { noAutofillInputProps } from '@src/lib/autofill'
import { useApp } from '@src/lib/boot'
import { isDesktop } from '@src/lib/isDesktop'
import { settingsSearchFocusRequest } from '@src/lib/searchFocusRequests'
import type { SettingsLevel } from '@src/lib/settings/settingsTypes'
import {
  formatSettingsLabel,
  hiddenOnPlatform,
} from '@src/lib/settings/settingsUtils'
import {
  KEYMAP_SCHEMA_VERSION,
  type KeymapScope,
  getKeymapItemScopes,
  keymapScopesValueSpec,
  keymapService,
  keymapValueSpec,
} from '@src/registry/contracts/keymap'

type ExtendedSettingsLevel = SettingsLevel | 'keybindings'

interface SettingsSearchBarProps {
  keybinding?: string
}

export type SettingsSearchItem = {
  name: string
  displayName: string
  description: string
  category: string
  level: ExtendedSettingsLevel
}

export function SettingsSearchBar({ keybinding }: SettingsSearchBarProps) {
  useSignals()
  const { settings, registry } = useApp()
  const keymap = registry.optional(keymapService)
  const contributedKeymap = registry.signal(keymapValueSpec).value
  const persistedKeymap = keymap?.persistedKeymap.value ?? {
    version: KEYMAP_SCHEMA_VERSION,
    bindings: [],
  }
  const keybindingRows = useMemo(
    () => getKeybindingRows(contributedKeymap.items, persistedKeymap.bindings),
    [contributedKeymap.items, persistedKeymap.bindings]
  )
  const keymapScopes = registry.signal(keymapScopesValueSpec).value
  const inputRef = useRef<HTMLInputElement>(null)
  const lastHandledFocusRequest = useRef(settingsSearchFocusRequest.value)
  useSignalEffect(() => {
    const request = settingsSearchFocusRequest.value
    if (request === lastHandledFocusRequest.current) {
      return
    }
    lastHandledFocusRequest.current = request
    inputRef.current?.focus()
  })
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const settingsValues = settings.useSettings()
  const settingsAsSearchable: SettingsSearchItem[] = useMemo(
    () => [
      ...Object.entries(settingsValues).flatMap(
        ([category, categorySettings]) =>
          Object.entries(categorySettings).flatMap(([settingName, setting]) => {
            const s = setting
            return (['project', 'user'] satisfies SettingsLevel[])
              .filter(
                (l) => s.hideOnLevel !== l && !hiddenOnPlatform(s, isDesktop())
              )
              .map((l) => ({
                category: formatSettingsLabel(category),
                name: settingName,
                description: s.description ?? '',
                displayName: formatSettingsLabel(settingName),
                level: l,
              }))
          })
      ),
      ...keybindingRows.map(
        (keybinding) =>
          ({
            name: keybinding.id,
            displayName: keybinding.title,
            description:
              keybinding.state === 'unbound'
                ? `Unbound - ${keybinding.command}`
                : keybinding.command,
            category: formatKeymapSearchCategory(keybinding, keymapScopes),
            level: 'keybindings',
          }) satisfies SettingsSearchItem
      ),
    ],
    [settingsValues, keybindingRows, keymapScopes]
  )
  const fuse = useMemo(
    () =>
      new Fuse(settingsAsSearchable, {
        keys: ['category', 'displayName', 'description'],
        includeScore: true,
      }),
    [settingsAsSearchable]
  )
  const searchResults = useMemo(
    () =>
      query.length > 0
        ? fuse.search(query).map((result) => result.item)
        : settingsAsSearchable,
    [fuse, query, settingsAsSearchable]
  )

  function handleSelection({ level, name }: SettingsSearchItem) {
    void navigate(`?tab=${level}#${encodeURIComponent(name)}`)
  }

  return (
    <Combobox onChange={handleSelection}>
      <div className="relative group">
        <div className="flex items-center gap-2 py-0.5 pr-1 pl-2 rounded border-solid border border-primary/10 dark:border-chalkboard-80 focus-within:border-primary dark:focus-within:border-chalkboard-30">
          <Combobox.Input
            {...noAutofillInputProps}
            ref={inputRef}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
            placeholder={
              keybinding ? `Search settings (${keybinding})` : 'Search settings'
            }
            autoFocus
          />
          <CustomIcon
            name="search"
            className="w-5 h-5 rounded-sm bg-primary/10 text-primary group-focus-within:bg-primary group-focus-within:text-chalkboard-10"
          />
        </div>
        <Combobox.Options className="absolute top-full mt-2 right-0 w-80 overflow-y-auto z-50 max-h-96 cursor-pointer bg-chalkboard-10 dark:bg-chalkboard-100 border border-solid border-primary dark:border-chalkboard-30 rounded">
          {searchResults?.map((option) => (
            <Combobox.Option
              key={`${option.category}-${option.name}-${option.level}`}
              value={option}
              className="flex flex-col items-start gap-2 px-4 py-2 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90"
            >
              <p className="flex-grow text-base capitalize m-0 leading-none">
                {option.level} · {option.category} · {option.displayName}
              </p>
              {option.description && (
                <p className="text-xs leading-tight text-chalkboard-70 dark:text-chalkboard-50">
                  {option.description}
                </p>
              )}
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </div>
    </Combobox>
  )
}

function formatKeymapSearchCategory(
  keybinding: Parameters<typeof getKeymapItemScopes>[0],
  keymapScopes: readonly KeymapScope[]
) {
  const keymapScopesById = new Map(
    keymapScopes.map((scope) => [scope.id, scope.displayName])
  )

  return getKeymapItemScopes(keybinding)
    .map((scope) => keymapScopesById.get(scope) ?? formatSettingsLabel(scope))
    .join(', ')
}
