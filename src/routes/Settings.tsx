import { ActionButton } from '../components/ActionButton'
import {
  SetEventTypes,
  SettingsLevel,
  WildcardSetEvent,
} from 'lib/settings/settingsTypes'
import { Toggle } from 'components/Toggle/Toggle'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { paths } from 'lib/paths'
import { useSettingsAuthContext } from 'hooks/useSettingsAuthContext'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import { createAndOpenNewProject, getSettingsFolderPaths } from 'lib/tauriFS'
import { sep } from '@tauri-apps/api/path'
import { isTauri } from 'lib/isTauri'
import toast from 'react-hot-toast'
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Setting } from 'lib/settings/initialSettings'
import decamelize from 'decamelize'
import { Event } from 'xstate'
import { Combobox, Dialog, RadioGroup, Transition } from '@headlessui/react'
import { CustomIcon, CustomIconName } from 'components/CustomIcon'
import Tooltip from 'components/Tooltip'
import {
  getSettingInputType,
  shouldHideSetting,
  shouldShowSettingInput,
} from 'lib/settings/settingsUtils'
import { getInitialDefaultDir, showInFolder } from 'lib/tauri'
import Fuse from 'fuse.js'

export const APP_VERSION = import.meta.env.PACKAGE_VERSION || 'unknown'

function SettingsSearchBar() {
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
  const { settings } = useSettingsAuthContext()
  const settingsAsSearchable = useMemo(
    () =>
      Object.entries(settings.state.context).flatMap(
        ([category, categorySettings]) =>
          Object.entries(categorySettings).flatMap(([settingName, setting]) => {
            const s = setting as Setting
            return ['project', 'user']
              .filter((l) => s.hideOnLevel !== l)
              .map((l) => ({
                category: decamelize(category, { separator: ' ' }),
                settingName: settingName,
                settingNameDisplay: decamelize(settingName, { separator: ' ' }),
                setting: s,
                level: l,
              }))
          })
      ),
    [settings.state.context]
  )
  const [searchResults, setSearchResults] = useState(settingsAsSearchable)

  const fuse = new Fuse(settingsAsSearchable, {
    keys: ['category', 'settingNameDisplay'],
    includeScore: true,
  })

  useEffect(() => {
    const results = fuse.search(query).map((result) => result.item)
    setSearchResults(query.length > 0 ? results : settingsAsSearchable)
  }, [query])

  function handleSelection({
    level,
    settingName,
  }: {
    category: string
    settingName: string
    setting: Setting<unknown>
    level: string
  }) {
    navigate(`?tab=${level}#${settingName}`)
  }

  return (
    <Combobox onChange={handleSelection}>
      <div className="relative">
        <div className="flex items-center gap-2 p-1 pl-2 rounded border-solid border border-primary/10 dark:border-chalkboard-80">
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
            className="w-5 h-5 bg-primary/10 text-primary"
          />
        </div>
        <Combobox.Options className="absolute top-full mt-2 right-0 overflow-y-auto z-50 max-h-96 cursor-pointer bg-chalkboard-10 dark:bg-chalkboard-100">
          {searchResults?.map((option) => (
            <Combobox.Option
              key={`${option.category}-${option.settingName}-${option.level}`}
              value={option}
              className="flex items-center gap-2 px-4 py-1 first:mt-2 last:mb-2 ui-active:bg-primary/10 dark:ui-active:bg-chalkboard-90"
            >
              <p className="flex-grow">
                {option.level} ·{' '}
                {decamelize(option.category, { separator: ' ' })} ·{' '}
                {option.settingNameDisplay}
              </p>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </div>
    </Combobox>
  )
}

export const Settings = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const close = () => navigate(location.pathname.replace(paths.SETTINGS, ''))
  const location = useLocation()
  const isFileSettings = location.pathname.includes(paths.FILE)
  const searchParamTab =
    (searchParams.get('tab') as SettingsLevel) ??
    (isFileSettings ? 'project' : 'user')
  const projectPath =
    isFileSettings && isTauri()
      ? decodeURI(
          location.pathname
            .replace(paths.FILE + '/', '')
            .replace(paths.SETTINGS, '')
            .slice(0, decodeURI(location.pathname).lastIndexOf(sep()))
        )
      : undefined

  const scrollRef = useRef<HTMLDivElement>(null)
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => navigate(dotDotSlash()))
  const {
    settings: {
      send,
      state: { context },
    },
  } = useSettingsAuthContext()

  function restartOnboarding() {
    send({
      type: `set.app.onboardingStatus`,
      data: { level: 'user', value: '' },
    })

    if (isFileSettings) {
      navigate(dotDotSlash(1) + paths.ONBOARDING.INDEX)
    } else {
      createAndOpenNewProject(navigate)
    }
  }

  // Scroll to the hash on load if it exists
  useEffect(() => {
    console.log('hash', location.hash)
    if (location.hash) {
      const element = document.getElementById(location.hash.slice(1))
      if (element) {
        element.scrollIntoView({ block: 'center', behavior: 'smooth' })
        ;(
          element.querySelector('input, select, textarea') as HTMLInputElement
        )?.focus()
      }
    }
  }, [location.hash])

  return (
    <Transition appear show={true} as={Fragment}>
      <Dialog
        as="div"
        open={true}
        onClose={close}
        className="fixed inset-0 z-40 overflow-y-auto p-4 grid place-items-center"
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Dialog.Overlay className="fixed inset-0 bg-chalkboard-110/30 dark:bg-chalkboard-110/50" />
        </Transition.Child>

        <Transition.Child
          as={Fragment}
          enter="ease-out duration-75"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
        >
          <Dialog.Panel className="rounded relative mx-auto bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 max-w-3xl w-full max-h-[66vh] shadow-lg flex flex-col gap-8">
            <div className="p-5 pb-0 flex justify-between items-center">
              <h1 className="text-2xl font-bold">Settings</h1>
              <div className="flex gap-4 items-start">
                <SettingsSearchBar />
                <button
                  onClick={close}
                  className="p-0 m-0 focus:ring-0 focus:outline-none border-none hover:bg-destroy-10 focus:bg-destroy-10 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
                  data-testid="settings-close-button"
                >
                  <CustomIcon name="close" className="w-5 h-5" />
                </button>
              </div>
            </div>
            <RadioGroup
              value={searchParamTab}
              onChange={(v) => setSearchParams((p) => ({ ...p, tab: v }))}
              className="flex justify-start pl-4 pr-5 gap-5 border-0 border-b border-b-chalkboard-20 dark:border-b-chalkboard-90"
            >
              <RadioGroup.Option value="user">
                {({ checked }) => (
                  <SettingsTabButton
                    checked={checked}
                    icon="person"
                    text="User"
                  />
                )}
              </RadioGroup.Option>
              {isFileSettings && (
                <RadioGroup.Option value="project">
                  {({ checked }) => (
                    <SettingsTabButton
                      checked={checked}
                      icon="folder"
                      text="This project"
                    />
                  )}
                </RadioGroup.Option>
              )}
            </RadioGroup>
            <div
              className="flex-1 grid items-stretch pl-4 pr-5 pb-5 gap-2 overflow-hidden"
              style={{ gridTemplateColumns: 'auto 1fr' }}
            >
              <div className="flex w-32 flex-col gap-3 pr-2 py-1 border-0 border-r border-r-chalkboard-20 dark:border-r-chalkboard-90">
                {Object.entries(context)
                  .filter(([_, categorySettings]) =>
                    // Filter out categories that don't have any non-hidden settings
                    Object.values(categorySettings).some(
                      (setting: Setting) =>
                        !shouldHideSetting(setting, searchParamTab)
                    )
                  )
                  .map(([category]) => (
                    <button
                      key={category}
                      onClick={() =>
                        scrollRef.current
                          ?.querySelector(`#category-${category}`)
                          ?.scrollIntoView({
                            block: 'center',
                            behavior: 'smooth',
                          })
                      }
                      className="capitalize text-left border-none px-1"
                    >
                      {decamelize(category, { separator: ' ' })}
                    </button>
                  ))}
                <button
                  onClick={() =>
                    scrollRef.current
                      ?.querySelector(`#settings-resets`)
                      ?.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      })
                  }
                  className="capitalize text-left border-none px-1"
                >
                  Resets
                </button>
                <button
                  onClick={() =>
                    scrollRef.current
                      ?.querySelector(`#settings-about`)
                      ?.scrollIntoView({
                        block: 'center',
                        behavior: 'smooth',
                      })
                  }
                  className="capitalize text-left border-none px-1"
                >
                  About
                </button>
              </div>
              <div className="relative overflow-y-auto">
                <div ref={scrollRef} className="flex flex-col gap-4 px-2">
                  {Object.entries(context)
                    .filter(([_, categorySettings]) =>
                      // Filter out categories that don't have any non-hidden settings
                      Object.values(categorySettings).some(
                        (setting) => !shouldHideSetting(setting, searchParamTab)
                      )
                    )
                    .map(([category, categorySettings]) => (
                      <Fragment key={category}>
                        <h2
                          id={`category-${category}`}
                          className="text-xl mt-6 first-of-type:mt-0 capitalize font-bold"
                        >
                          {decamelize(category, { separator: ' ' })}
                        </h2>
                        {Object.entries(categorySettings)
                          .filter(
                            // Filter out settings that don't have a Component or inputType
                            // or are hidden on the current level or the current platform
                            (item: [string, Setting<unknown>]) =>
                              shouldShowSettingInput(item[1], searchParamTab)
                          )
                          .map(([settingName, s]) => {
                            const setting = s as Setting
                            const parentValue =
                              setting[setting.getParentLevel(searchParamTab)]
                            return (
                              <SettingsSection
                                title={decamelize(settingName, {
                                  separator: ' ',
                                })}
                                id={settingName}
                                className={
                                  location.hash === `#${settingName}`
                                    ? 'bg-primary/10 dark:bg-chalkboard-90'
                                    : ''
                                }
                                key={`${category}-${settingName}-${searchParamTab}`}
                                description={setting.description}
                                settingHasChanged={
                                  setting[searchParamTab] !== undefined &&
                                  setting[searchParamTab] !==
                                    setting.getFallback(searchParamTab)
                                }
                                parentLevel={setting.getParentLevel(
                                  searchParamTab
                                )}
                                onFallback={() =>
                                  send({
                                    type: `set.${category}.${settingName}`,
                                    data: {
                                      level: searchParamTab,
                                      value:
                                        parentValue !== undefined
                                          ? parentValue
                                          : setting.getFallback(searchParamTab),
                                    },
                                  } as SetEventTypes)
                                }
                              >
                                <GeneratedSetting
                                  category={category}
                                  settingName={settingName}
                                  settingsLevel={searchParamTab}
                                  setting={setting}
                                />
                              </SettingsSection>
                            )
                          })}
                      </Fragment>
                    ))}
                  <h2 id="settings-resets" className="text-2xl mt-6 font-bold">
                    Resets
                  </h2>
                  <SettingsSection
                    title="Onboarding"
                    description="Replay the onboarding process"
                  >
                    <ActionButton
                      Element="button"
                      onClick={restartOnboarding}
                      icon={{
                        icon: 'refresh',
                        size: 'sm',
                        className: 'p-1',
                      }}
                    >
                      Replay Onboarding
                    </ActionButton>
                  </SettingsSection>
                  <SettingsSection
                    title="Reset settings"
                    description={`Restore settings to their default values. Your settings are saved in
                    ${
                      isTauri()
                        ? ' a file in the app data folder for your OS.'
                        : " your browser's local storage."
                    }
                  `}
                  >
                    <div className="flex flex-col items-start gap-4">
                      {isTauri() && (
                        <ActionButton
                          Element="button"
                          onClick={async () => {
                            const paths = await getSettingsFolderPaths(
                              projectPath
                                ? decodeURIComponent(projectPath)
                                : undefined
                            )
                            showInFolder(paths[searchParamTab])
                          }}
                          icon={{
                            icon: 'folder',
                            size: 'sm',
                            className: 'p-1',
                          }}
                        >
                          Show in folder
                        </ActionButton>
                      )}
                      <ActionButton
                        Element="button"
                        onClick={async () => {
                          const defaultDirectory = await getInitialDefaultDir()
                          send({
                            type: 'Reset settings',
                            defaultDirectory,
                          })
                          toast.success('Settings restored to default')
                        }}
                        icon={{
                          icon: 'refresh',
                          size: 'sm',
                          className: 'p-1 text-chalkboard-10',
                          bgClassName: 'bg-destroy-70',
                        }}
                      >
                        Restore default settings
                      </ActionButton>
                    </div>
                  </SettingsSection>
                  <h2 id="settings-about" className="text-2xl mt-6 font-bold">
                    About Modeling App
                  </h2>
                  <div className="text-sm mb-12">
                    <p>
                      {/* This uses a Vite plugin, set in vite.config.ts
                  to inject the version from package.json */}
                      App version {APP_VERSION}.{' '}
                      <a
                        href={`https://github.com/KittyCAD/modeling-app/releases/tag/v${APP_VERSION}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View release on GitHub
                      </a>
                    </p>
                    <p className="max-w-2xl mt-6">
                      Don't see the feature you want? Check to see if it's on{' '}
                      <a
                        href="https://github.com/KittyCAD/modeling-app/discussions"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        our roadmap
                      </a>
                      , and start a discussion if you don't see it! Your
                      feedback will help us prioritize what to build next.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  )
}

interface SettingsSectionProps extends React.HTMLProps<HTMLDivElement> {
  title: string
  titleClassName?: string
  description?: string
  className?: string
  parentLevel?: SettingsLevel | 'default'
  onFallback?: () => void
  settingHasChanged?: boolean
  headingClassName?: string
}

export function SettingsSection({
  title,
  titleClassName,
  id,
  description,
  className,
  children,
  parentLevel,
  settingHasChanged,
  onFallback,
  headingClassName = 'text-lg font-normal capitalize tracking-wide',
}: SettingsSectionProps) {
  return (
    <section
      id={id}
      className={
        'group p-2 pl-0 grid grid-cols-2 gap-6 items-start ' +
        className +
        (settingHasChanged ? ' border-0 border-l-2 -ml-0.5 border-primary' : '')
      }
    >
      <div className="ml-2">
        <div className="flex items-center gap-2">
          <h2 className={headingClassName}>{title}</h2>
          {onFallback && parentLevel && settingHasChanged && (
            <button
              onClick={onFallback}
              className="hidden group-hover:block group-focus-within:block border-none p-0 hover:bg-warn-10 dark:hover:bg-warn-80 focus:bg-warn-10 dark:focus:bg-warn-80 focus:outline-none"
            >
              <CustomIcon name="refresh" className="w-4 h-4" />
              <span className="sr-only">Roll back {title}</span>
              <Tooltip position="right">
                Roll back to match {parentLevel}
              </Tooltip>
            </button>
          )}
        </div>
        {description && (
          <p className="mt-2 text-xs text-chalkboard-80 dark:text-chalkboard-30">
            {description}
          </p>
        )}
      </div>
      <div>{children}</div>
    </section>
  )
}

interface GeneratedSettingProps {
  // We don't need the fancy types here,
  // it doesn't help us with autocomplete or anything
  category: string
  settingName: string
  settingsLevel: SettingsLevel
  setting: Setting<unknown>
}

function GeneratedSetting({
  category,
  settingName,
  settingsLevel,
  setting,
}: GeneratedSettingProps) {
  const {
    settings: { context, send },
  } = useSettingsAuthContext()
  const options = useMemo(() => {
    return setting.commandConfig &&
      'options' in setting.commandConfig &&
      setting.commandConfig.options
      ? setting.commandConfig.options instanceof Array
        ? setting.commandConfig.options
        : setting.commandConfig.options(
            {
              argumentsToSubmit: {
                level: settingsLevel,
              },
            },
            context
          )
      : []
  }, [setting, settingsLevel, context])
  const inputType = getSettingInputType(setting)

  switch (inputType) {
    case 'component':
      return (
        setting.Component && (
          <setting.Component
            value={setting[settingsLevel] || setting.getFallback(settingsLevel)}
            updateValue={(newValue) => {
              send({
                type: `set.${category}.${settingName}`,
                data: {
                  level: settingsLevel,
                  value: newValue,
                },
              } as unknown as Event<WildcardSetEvent>)
            }}
          />
        )
      )
    case 'boolean':
      return (
        <Toggle
          offLabel="Off"
          onLabel="On"
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: Boolean(e.target.checked),
              },
            } as SetEventTypes)
          }
          checked={Boolean(
            setting[settingsLevel] !== undefined
              ? setting[settingsLevel]
              : setting.getFallback(settingsLevel)
          )}
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
        />
      )
    case 'options':
      return (
        <select
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full"
          value={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
          onChange={(e) =>
            send({
              type: `set.${category}.${settingName}`,
              data: {
                level: settingsLevel,
                value: e.target.value,
              },
            } as unknown as Event<WildcardSetEvent>)
          }
        >
          {options &&
            options.length > 0 &&
            options.map((option) => (
              <option key={option.name} value={String(option.value)}>
                {option.name}
              </option>
            ))}
        </select>
      )
    case 'string':
      return (
        <input
          name={`${category}-${settingName}`}
          data-testid={`${category}-${settingName}`}
          type="text"
          className="p-1 bg-transparent border rounded-sm border-chalkboard-30 w-full"
          defaultValue={String(
            setting[settingsLevel] || setting.getFallback(settingsLevel)
          )}
          onBlur={(e) => {
            if (
              setting[settingsLevel] === undefined
                ? setting.getFallback(settingsLevel) !== e.target.value
                : setting[settingsLevel] !== e.target.value
            ) {
              send({
                type: `set.${category}.${settingName}`,
                data: {
                  level: settingsLevel,
                  value: e.target.value,
                },
              } as unknown as Event<WildcardSetEvent>)
            }
          }}
        />
      )
  }
  return (
    <p className="text-destroy-70 dark:text-destroy-20">
      No component or input type found for setting {settingName} in category{' '}
      {category}
    </p>
  )
}

interface SettingsTabButtonProps {
  checked: boolean
  icon: CustomIconName
  text: string
}

function SettingsTabButton(props: SettingsTabButtonProps) {
  const { checked, icon, text } = props
  return (
    <div
      className={`cursor-pointer select-none flex items-center gap-1 p-1 pr-2 -mb-[1px] border-0 border-b ${
        checked
          ? 'border-primary'
          : 'border-chalkboard-20 dark:border-chalkboard-30 hover:bg-primary/20 dark:hover:bg-primary/50'
      }`}
    >
      <CustomIcon
        name={icon}
        className={
          'w-5 h-5 ' + (checked ? 'bg-primary !text-chalkboard-10' : '')
        }
      />
      <span>{text}</span>
    </div>
  )
}
