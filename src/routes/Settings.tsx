import { Dialog } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { useCallback, useEffect, useRef } from 'react'
// eslint-disable-next-line zds/no-react-router-hooks -- URL-state migration: query-based tabs and hash-based scrolling (useLocation, useNavigate, useSearchParams).
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
import { platform } from '@src/lib/utils'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'

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
  useSignals()
  const app = useApp()
  const keymap = app.registry.optional(keymapService)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const close = () => {
    // This makes sure input texts are saved before closing the dialog (eg. default project name).
    if (document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur()
    }
    void navigate(location.pathname.replace(PATHS.SETTINGS, ''))
  }
  const location = useLocation()
  const isFileSettings = location.pathname.includes(PATHS.FILE)
  const hasOpenProject = app.project !== undefined
  const defaultTab: SettingsLevel =
    isFileSettings && hasOpenProject ? 'project' : 'user'
  const requestedTab = searchParams.get('tab')
  const requestedSettingsTab =
    requestedTab === 'project' && !hasOpenProject
      ? 'user'
      : isSettingsTab(requestedTab)
        ? requestedTab
        : defaultTab
  const searchParamTab = requestedSettingsTab

  const scrollRef = useRef<HTMLDivElement>(null)
  // The Dialog portal can mount after this component's first effect. Own hash
  // scrolling at the real fields' ref commit rather than guessing a next tick.
  const setScrollContainer = useCallback(
    (element: HTMLDivElement | null) => {
      scrollRef.current = element
      if (!element || !location.hash) return
      const target = element.ownerDocument.getElementById(
        decodeURIComponent(location.hash.slice(1))
      )
      if (!target || !element.contains(target)) return
      target.scrollIntoView({ block: 'center', behavior: 'instant' })
      target.querySelector<HTMLElement>('input, select, textarea')?.focus()
    },
    [location.hash]
  )
  const settingsSearchKeybinding = keymapKeystrokesDisplay(
    keymap
      ? findKeymapItemForCommand(
          keymap.keymap.value,
          APP_COMMAND_IDS.search.focusSettings,
          ['settings-open'],
          app.registry.signal(keymapScopesValueSpec).value
        )?.keystrokes
      : undefined,
    platform()
  )

  useEffect(() => {
    if (!keymap) {
      return
    }

    keymap.applyScope('settings-open')

    return () => {
      keymap.removeScope('settings-open')
    }
  }, [keymap])

  return (
    <Dialog
      as="div"
      open={true}
      onClose={close}
      className="fixed inset-0 z-40 overflow-y-auto p-4 grid place-items-center"
    >
      <Dialog.Overlay className="fixed inset-0 bg-chalkboard-110/30 dark:bg-chalkboard-110/50" />
      <Dialog.Panel
        data-testid="settings-dialog-panel"
        data-command-bar-host
        className="rounded relative mx-auto bg-chalkboard-10 dark:bg-chalkboard-100 border dark:border-chalkboard-70 w-[90vw] h-[80vh] max-h-[calc(100vh-2rem)] shadow-lg flex flex-col gap-8"
      >
        <div className="p-5 pb-0 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Settings</h1>
          <div className="flex gap-4 items-start">
            <SettingsSearchBar
              keybinding={settingsSearchKeybinding}
              hasOpenProject={hasOpenProject}
            />
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
              />
              <AllSettingsFields
                searchParamTab={searchParamTab}
                isFileSettings={isFileSettings}
                ref={setScrollContainer}
              />
            </>
          ) : searchParamTab === 'keybindings' ? (
            <AllKeybindingsFields ref={setScrollContainer} />
          ) : searchParamTab === 'plugins' ? (
            <PluginsList
              ref={setScrollContainer}
              registry={app.registry}
              plugins={app.registry.signal(pluginsValueSpec).value}
            />
          ) : null}
        </div>
      </Dialog.Panel>
    </Dialog>
  )
}
