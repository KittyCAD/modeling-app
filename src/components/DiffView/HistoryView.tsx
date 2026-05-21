import { useSignals } from '@preact/signals-react/runtime'
import {
  getProjectDirectoryFromKCLFilePath,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { CustomIcon } from '@src/components/CustomIcon'
import { useApp, useSingletons } from '@src/lib/boot'

export const HistoryView = (props: AreaTypeComponentProps) => {
  useSignals()
  const { kclManager } = useSingletons()
  const { settings, project } = useApp()
  const settingsValues = settings.useSettings()
  const theValue = kclManager?.history?.entries?.value || []
  const applicationProjectDirectory =
    settingsValues.app.projectDirectory.current
  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="stopwatch"
        title={props.layout.label}
        onClose={props.onClose}
      />
      <div className="w-full h-full relative overflow-y-auto overflow-x-hidden">
        <div className="w-full h-full flex flex-col">
          <div className="pb-12 inset-0">
            {theValue
              .filter((e) => {
                const projectDirectoryName = getProjectDirectoryFromKCLFilePath(
                  e.absoluteFilePath,
                  applicationProjectDirectory
                )
                return projectDirectoryName === project?.name
              })
              .map((e) => {
                const path = parentPathRelativeToProject(
                  e.absoluteFilePath,
                  applicationProjectDirectory
                )
                const month = e.date.toLocaleString('default', {
                  month: 'long',
                })
                const dayOfMonth = e.date.getDate()
                const year = e.date.getFullYear()
                return (
                  <div
                    className={`px-2 flex flex-row flex-wrap items-center justify-between text-xs cursor-pointer -outline-offset-1 hover:outline hover:outline-1 hover:bg-gray-300/50 hover:bg-gray-300/50`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      kclManager.history.lastEntrySelected.value = e
                    }}
                  >
                    <div className="flex flex-row items-center w-64 truncate text-ellipsis whitespace-nowrap">
                      <CustomIcon
                        name="kcl"
                        className="inline-block w-4 text-current mr-1"
                      />
                      <span className="pr-2">{path}</span>
                    </div>
                    {!e.wroteToDisk && (
                      <CustomIcon
                        name="bug"
                        className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                    )}
                    {e.source === 'Zookeeper' && (
                      <span className="text-ellipsis whitespace-nowrap px-2">
                        {e.source}
                      </span>
                    )}
                    {e.deleted && (
                      <CustomIcon
                        name="trash"
                        className="w-5 h-5 text-chalkboard-70 dark:text-chalkboard-40"
                      />
                    )}
                    <span className="text-ellipsis whitespace-nowrap px-2">
                      {month} {dayOfMonth}, {year} at{' '}
                      {e.date.toLocaleTimeString()}
                    </span>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </LayoutPanel>
  )
}
