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
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { Setting } from 'lib/settings/initialSettings'
import decamelize from 'decamelize'
import { Event } from 'xstate'
import { Dialog, Transition } from '@headlessui/react'
import { CustomIcon } from 'components/CustomIcon'
import {
  getSettingInputType,
  shouldHideSetting,
  shouldShowSettingInput,
} from 'lib/settings/settingsUtils'
import { getInitialDefaultDir, showInFolder } from 'lib/tauri'
import { SettingsSearchBar } from 'components/Settings/SettingsSearchBar'
import { SettingsTabs } from 'components/Settings/SettingsTabs'
import { SettingsSection } from 'components/Settings/SettingsSection'
import { SettingsFieldInput } from 'components/Settings/SettingsFieldInput'

export const APP_VERSION = import.meta.env.PACKAGE_VERSION || 'unknown'

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
            <SettingsTabs
              value={searchParamTab}
              onChange={(v) => setSearchParams((p) => ({ ...p, tab: v }))}
              showProjectTab={isFileSettings}
            />
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
                                <SettingsFieldInput
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
