import { ProjectArchiveLimitMessage } from '@src/components/ProjectArchiveLimitMessage'
import { getProjectArchiveLimitError } from '@src/lib/cloudProjects/runtime/archiveContents'
import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useState } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { projectSessionService } from '@src/lib/projectSession/next/contract'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { routerService } from '@src/registry/contracts/router'
import { PATHS } from '@src/lib/paths'
import { isOffline } from '@src/lib/networkStatus'
import { reportRejection } from '@src/lib/trap'

/** Connectivity and persistence status belong to the project, across all editor modes. */
export function CloudProjectStatus({
  app,
  className,
}: {
  app: Pick<AppHeaderItemProps['app'], 'registry'>
  className: string
}) {
  useSignals()
  const { registry } = app
  const [offline, setOffline] = useState(isOffline)
  useEffect(() => {
    const update = () => setOffline(isOffline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  const id = registry.optional(projectSessionService)?.currentProject.value
    ?.storage?.projectId
  const cloud = registry.optional(cloudStorageService)
  const pathname = registry.optional(routerService)?.location.value.pathname
  if (
    !id ||
    !cloud ||
    pathname !== `${PATHS.PROJECT}/${encodeURIComponent(id)}`
  )
    return null
  const status = cloud.saves.value.get(id)
  if (offline)
    return (
      <span
        role="status"
        className={className}
        title="Cloud editors are read-only until the connection returns."
      >
        <CustomIcon name="networkCrossedOut" className="h-4 w-4" aria-hidden />
        Offline
      </span>
    )
  if (status?.state === 'saving')
    return (
      <span role="status" className={className}>
        Saving…
      </span>
    )
  if (status?.state !== 'failed') return null
  const limitError = getProjectArchiveLimitError(status.error)
  if (limitError)
    return (
      <div role="status" className={className}>
        <ProjectArchiveLimitMessage error={limitError} align="right" />
      </div>
    )
  return (
    <div role="status" className={className}>
      <span title="Your edits remain local.">Save failed</span>
      <button
        type="button"
        className="underline"
        onClick={() => {
          void cloud.retry(id).catch(reportRejection)
        }}
      >
        Retry
      </button>
    </div>
  )
}
