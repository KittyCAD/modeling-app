import { SettingsLevel } from 'lib/settings/settingsTypes'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useHotkeys } from 'react-hotkeys-hook'
import { PATHS } from 'lib/paths'
import { useDotDotSlash } from 'hooks/useDotDotSlash'
import { Fragment, useEffect, useRef } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { CustomIcon } from 'components/CustomIcon'
import { SettingsSearchBar } from 'components/Settings/SettingsSearchBar'
import { SettingsTabs } from 'components/Settings/SettingsTabs'
import { SettingsSectionsList } from 'components/Settings/SettingsSectionsList'
import { AllSettingsFields } from 'components/Settings/AllSettingsFields'
import { AllKeybindingsFields } from 'components/Settings/AllKeybindingsFields'
import { KeybindingsSectionsList } from 'components/Settings/KeybindingsSectionsList'
import { isDesktop } from 'lib/isDesktop'
import { IS_PLAYWRIGHT_KEY } from '../../e2e/playwright/storageStates'
import { NODE_ENV } from 'env'

import {
  getMarks,
  printDeltaTotal,
  printInvocationCount,
  printMarkDownTable,
  printRawMarks,
} from 'lib/performance'

const isTestEnv = window?.localStorage.getItem(IS_PLAYWRIGHT_KEY) === 'true'

export const APP_VERSION =
  isTestEnv && NODE_ENV === 'development'
    ? '11.22.33'
    : isDesktop()
    ? // @ts-ignore
      window.electron.packageJson.version
    : 'main'

export const Telemetry = () => {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const close = () => navigate(location.pathname.replace(PATHS.TELEMETRY, ''))
  const location = useLocation()
  const isFileSettings = location.pathname.includes(PATHS.FILE)
  const searchParamTab =
    (searchParams.get('tab') as SettingsLevel | 'keybindings') ??
    (isFileSettings ? 'project' : 'user')

  const scrollRef = useRef<HTMLDivElement>(null)
  const dotDotSlash = useDotDotSlash()
  useHotkeys('esc', () => navigate(dotDotSlash()))

  // todo a focus?

  const marks = getMarks()
  const markdownTable = printMarkDownTable(marks)
  const rawMarks = printRawMarks(marks)
  const deltaTotalTable = printDeltaTotal(marks)
  const invocationCount = printInvocationCount(marks)

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
              <h1 className="text-2xl font-bold">Telemetry</h1>
              <div className="flex gap-4 items-start">
                <button
                  onClick={close}
                  className="p-0 m-0 focus:ring-0 focus:outline-none border-none hover:bg-destroy-10 focus:bg-destroy-10 dark:hover:bg-destroy-80/50 dark:focus:bg-destroy-80/50"
                  data-testid="settings-close-button"
                >
                  <CustomIcon name="close" className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div
              className="flex-1 grid items-stretch pl-4 pr-5 pb-5 gap-2 overflow-scroll"
              style={{
                gridTemplateColumns: 'auto 1fr',
                gridTemplateRows: '1fr',
              }}
            >
              <div>
                <h1 className="pb-4">Marks</h1>
                <div className="max-w-xl max-h-64 overflow-auto select-all">
                  {marks.map((mark, index) => {
                    return (
                      <pre className="text-xs" key={index}>
                        <code key={index}>{JSON.stringify(mark, null, 2)}</code>
                      </pre>
                    )
                  })}
                </div>
                <h1 className="pb-4">Startup Performance</h1>
                <div className="max-w-xl max-h-64 overflow-auto select-all">
                  {markdownTable.map((line, index) => {
                    return (
                      <pre className="text-xs" key={index}>
                        <code key={index}>{line}</code>
                      </pre>
                    )
                  })}
                </div>
                <h1 className="pb-4">Delta and Totals</h1>
                <div className="max-w-xl max-h-64 overflow-auto select-all">
                  {deltaTotalTable.map((line, index) => {
                    return (
                      <pre className="text-xs" key={index}>
                        <code key={index}>{line}</code>
                      </pre>
                    )
                  })}
                </div>
                <h1 className="pb-4">Raw Marks</h1>
                <div className="max-w-xl max-h-64 overflow-auto select-all">
                  {rawMarks.map((line, index) => {
                    return (
                      <pre className="text-xs" key={index}>
                        <code key={index}>{line}</code>
                      </pre>
                    )
                  })}
                </div>
                <h1 className="pb-4">Invocation Count</h1>
                <div className="max-w-xl max-h-64 overflow-auto select-all">
                  {invocationCount.map((line, index) => {
                    return (
                      <pre className="text-xs" key={index}>
                        <code key={index}>{line}</code>
                      </pre>
                    )
                  })}
                </div>
              </div>
            </div>
          </Dialog.Panel>
        </Transition.Child>
      </Dialog>
    </Transition>
  )
}
