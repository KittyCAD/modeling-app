import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { pluginsValueSpec } from '@kittycad/registry'
import { CustomIcon } from '@src/components/CustomIcon'
import { PluginsList } from '@src/components/PluginList'
import { AllKeybindingsFields } from '@src/components/Settings/AllKeybindingsFields'
import { AllSettingsFields } from '@src/components/Settings/AllSettingsFields'
import { SettingsSearchBar } from '@src/components/Settings/SettingsSearchBar'
import { SettingsSectionsList } from '@src/components/Settings/SettingsSectionsList'
import { SettingsTabs } from '@src/components/Settings/SettingsTabs'
import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import type { SettingsLevel } from '@src/lib/settings/settingsTypes'
import { userHasFeature } from '@src/lib/settings/settingsUtils'
import { keymapService } from '@src/registry/contracts/keymap'

const PLUGINS_FEATURE_FLAG = 'plugins'

type SettingsTab = SettingsLevel | 'keybindings' | 'plugins'

function isSettingsTab(tab: string | null): tab is SettingsTab {
  return (
    tab === 'user' ||
    tab === 'project' ||
    tab === 'keybindings' ||
    tab === 'plugins'
  )
}

export const Settings = () => {
  const app = useApp()
  const keymap = app.registry.optional(keymapService)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showPluginsTab, setShowPluginsTab] = useState(false)
  const close = () => {
    // This makes sure input texts are saved before closing the dialog (eg. default project name).
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur()
    }
    void navigate(location.pathname.replace(PATHS.SETTINGS, ''))
  }
  const location = useLocation()
  const isFileSettings = location.pathname.includes(PATHS.FILE)
  const defaultTab: SettingsLevel = isFileSettings ? 'project' : 'user'
  const requestedTab = searchParams.get('tab')
  const requestedSettingsTab = isSettingsTab(requestedTab)
    ? requestedTab
    : defaultTab
  const searchParamTab =
    requestedSettingsTab === 'plugins' && !showPluginsTab
      ? defaultTab
      : requestedSettingsTab

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    void userHasFeature(PLUGINS_FEATURE_FLAG, false).then((enabled) => {
      if (!cancelled) {
        setShowPluginsTab(enabled)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!keymap) {
      return
    }

    keymap.applyScope('settings-open')

    return () => {
      keymap.removeScope('settings-open')
    }
  }, [keymap])

  // Scroll to the hash on load if it exists
  useEffect(() => {
    console.log('hash', location.hash)
    if (location.hash) {
      setTimeout(() => {
        // GOTCHA: Next tick required, you can instantly navigate to a path and this code will find a null element and not scroll into view.
        const element = document.getElementById(location.hash.slice(1))
        if (element) {
          element.scrollIntoView({ block: 'center', behavior: 'smooth' })
          ;(
            element.querySelector('input, select, textarea') as HTMLInputElement
          )?.focus()
        }
      }, 0)
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
          <Dialog.Panel
            data-testid="settings-dialog-panel"
            className="rounded relative mx-auto bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 w-[90vw] h-[80vh] max-h-[calc(100vh-2rem)] shadow-lg flex flex-col gap-8"
          >
            <div className="p-5 pb-0 flex justify-between items-center">
              <h1 className="text-2xl font-bold">Settings</h1>
              <div className="flex gap-4 items-start">
                <SettingsSearchBar showPlugins={showPluginsTab} />
                <button
                  type="button"
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
              showPluginsTab={showPluginsTab}
            />
            <div
              className="flex-1 grid items-stretch pl-4 pr-5 pb-5 gap-2 overflow-hidden"
              style={{
                gridTemplateColumns:
                  searchParamTab === 'user' || searchParamTab === 'project'
                    ? 'auto 1fr'
                    : '1fr',
                gridTemplateRows: '1fr',
              }}
            >
              {searchParamTab === 'user' || searchParamTab === 'project' ? (
                <>
                  <SettingsSectionsList
                    searchParamTab={searchParamTab}
                    scrollRef={scrollRef}
                    showPlugins={showPluginsTab}
                  />
                  <AllSettingsFields
                    searchParamTab={searchParamTab}
                    isFileSettings={isFileSettings}
                    showPlugins={showPluginsTab}
                    ref={scrollRef}
                  />
                </>
              ) : searchParamTab === 'keybindings' ? (
                <AllKeybindingsFields ref={scrollRef} />
              ) : searchParamTab === 'plugins' && showPluginsTab ? (
                <PluginsList
                  ref={scrollRef}
                  registry={app.registry}
                  plugins={app.registry.signal(pluginsValueSpec).value}
                />
              ) : null}
            </div>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  )
}
