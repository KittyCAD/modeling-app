import { kclManager } from '@src/lib/singletons'
import { useSignals } from '@preact/signals-react/runtime'
import { useSettings } from '@src/lib/singletons'
import {
  getProjectDirectoryFromKCLFilePath,
  parentPathRelativeToApplicationDirectory,
  parentPathRelativeToProject,
} from '@src/lib/paths'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import type { IndexLoaderData } from '@src/lib/types'
import { useLoaderData } from 'react-router-dom'
import { CustomIcon } from '@src/components/CustomIcon'

function timeSince(date: Date) {
  const now = new Date()
  // @ts-expect-error: You can subtract two dates.
  const seconds = Math.floor((now - date) / 1000)
  let interval = seconds / 31536000
  if (interval > 1) {
    return Math.floor(interval) + ' years'
  }
  interval = seconds / 2592000
  if (interval > 1) {
    return Math.floor(interval) + ' months'
  }
  interval = seconds / 86400
  if (interval > 1) {
    return Math.floor(interval) + ' days'
  }
  interval = seconds / 3600
  if (interval > 1) {
    return Math.floor(interval) + ' hours'
  }
  interval = seconds / 60
  if (interval > 1) {
    return Math.floor(interval) + ' minutes'
  }
  return Math.floor(seconds) + ' seconds'
}

export const HistoryView = (props: AreaTypeComponentProps) => {
  useSignals()
  const theValue = kclManager.history.entries.value
  const settings = useSettings()
  const applicationProjectDirectory = settings.app.projectDirectory.current
  const loaderData = useLoaderData() as IndexLoaderData
  const { project } = loaderData

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
                return projectDirectoryName === project.name
              })
              .map((e) => {
                const path = parentPathRelativeToProject(
                  e.absoluteFilePath,
                  applicationProjectDirectory
                )
                const projectPath = parentPathRelativeToApplicationDirectory(
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
                    className={`px-2 h-5 flex flex-row items-center justify-between text-xs cursor-pointer -outline-offset-1 hover:outline hover:outline-1 hover:bg-gray-300/50 hover:bg-gray-300/50`}
                    role="button"
                    tabIndex="0"
                    onClick={() =>
                      (kclManager.history.lastEntrySelected.value = e)
                    }
                  >
                    <div className="flex flex-row items-center">
                      <CustomIcon
                        name="kcl"
                        className="inline-block w-4 text-current mr-1"
                      />
                      <span className="pr-2 text-ellipsis whitespace-nowrap">
                        {path}
                      </span>
                      <span className="text-xs text-chalkboard-80 dark:text-chalkboard-30 text-ellipsis whitespace-nowrap">
                        {projectPath}
                      </span>
                    </div>
                    {e.wroteToDisk && (
                      <span className="text-ellipsis whitespace-nowrap px-2">
                        saved to disk
                      </span>
                    )}
                    <span className="text-ellipsis whitespace-nowrap px-2">
                      {timeSince(e.date)} ago ({month} {dayOfMonth}, {year} at{' '}
                      {e.date.toLocaleTimeString()})
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
