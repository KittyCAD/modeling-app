import { Combobox } from '@headlessui/react'
import { CustomIcon } from 'components/CustomIcon'
import decamelize from 'decamelize'
import Fuse from 'fuse.js'
import { interactionMap } from 'lib/settings/initialKeybindings'
import { SettingsLevel } from 'lib/settings/settingsTypes'
import { useSettings } from 'machines/appMachine'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'

type ExtendedSettingsLevel = SettingsLevel | 'keybindings'

export type SettingsSearchItem = {
  name: string
  displayName: string
  description: string
  category: string
  level: ExtendedSettingsLevel
}

export function SettingsSearchBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  useHotkeys(
    'Ctrl+.',
    (e) => {
      e.preventDefault()
      inputRef.current?.focus()
    },
    { enableOnFormTags: true }
  )
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const settings = useSettings()
  const settingsAsSearchable: SettingsSearchItem[] = useMemo(
    () => [
      ...Object.entries(settings).flatMap(([category, categorySettings]) =>
        Object.entries(categorySettings).flatMap(([settingName, setting]) => {
          const s = setting
          return (['project', 'user'] satisfies SettingsLevel[])
            .filter((l) => s.hideOnLevel !== l)
            .map((l) => ({
              category: decamelize(category, { separator: ' ' }),
              name: settingName,
              description: s.description ?? '',
              displayName: decamelize(settingName, { separator: ' ' }),
              level: l,
            }))
        })
      ),
      ...Object.entries(interactionMap).flatMap(
        ([category, categoryKeybindings]) =>
          categoryKeybindings.map((keybinding) => ({
            name: keybinding.name,
            displayName: keybinding.title,
            description: keybinding.description,
            category: category,
            level: 'keybindings' as ExtendedSettingsLevel,
          }))
      ),
    ],
    [settings]
  )
  const [searchResults, setSearchResults] = useState(settingsAsSearchable)

  const fuse = new Fuse(settingsAsSearchable, {
    keys: ['category', 'displayName', 'description'],
    includeScore: true,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setSearchResults(query.length > 0 ? results : settingsAsSearchable)
  }, [query])

  function handleSelection({ level, name }: SettingsSearchItem) {
    navigate(`?tab=${level}#${name}`)
  }

  return (
    <Combobox onChange={handleSelection}>
      <div className="relative group">
        <div className="flex items-center gap-2 py-0.5 pr-1 pl-2 rounded border-solid border border-primary/10 dark:border-chalkboard-80 focus-within:border-primary dark:focus-within:border-chalkboard-30">
          <Combobox.Input
            ref={inputRef}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full bg-transparent focus:outline-none selection:bg-primary/20 dark:selection:bg-primary/40 dark:focus:outline-none"
            placeholder="Search settings (^.)"
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
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
                {option.level} ·{' '}
                {decamelize(option.category, { separator: ' ' })} ·{' '}
                {option.displayName}
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
