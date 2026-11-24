import { ProjectArchiveLimitMessage } from '@src/components/ProjectArchiveLimitMessage'
import { cloudStorageService } from '@src/lib/cloudProjects/registry/contract'
import { useSignals } from '@preact/signals-react/runtime'
import { FileSaveStatus } from '@src/components/FileSaveStatus'
import type { App } from '@src/lib/app'
import { selectCommand } from '@src/lib/commandUtils'
import { findHomeProjectByPath } from '@src/lib/homeProjects'
import { commandSystemService } from '@src/registry/contracts/commands'
import {
  homeProjectActionsService,
  homeProjectEntriesFacet,
} from '@src/registry/contracts/homeProjects'
import { projectSession } from '@src/registry/contracts/projectSession'

export function SaveStatusHeaderItem({ app }: { app: Pick<App, 'registry'> }) {
  useSignals()
  const cloud = app.registry.optional(cloudStorageService)
  const limitFailure = cloud?.archiveLimitFailure.value
  if (limitFailure)
    return (
      <span
        role="status"
        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-2"
      >
        <ProjectArchiveLimitMessage error={limitFailure} />
        <button
          type="button"
          onClick={() => cloud.dismissArchiveLimitFailure()}
          aria-label="Dismiss archive limit message"
        >
          Dismiss
        </button>
      </span>
    )
  const session = app.registry.optional(projectSession)
  if (!session) return null
  const path = session.project.value?.path
  const project = path
    ? findHomeProjectByPath(
        app.registry.observe(homeProjectEntriesFacet).value,
        path
      )
    : undefined
  const canCopy =
    project &&
    !project.readWriteAccess &&
    app.registry
      .optional(homeProjectActionsService)
      ?.canDuplicateToLibrary(project)
  return (
    <FileSaveStatus
      project={session.project}
      storageFor={session.storageFor}
      retrySave={session.retrySave}
      readOnlyAction={
        canCopy && (
          <button
            type="button"
            onClick={() =>
              selectCommand(app.registry.required(commandSystemService), {
                groupId: 'projects',
                name: 'Duplicate project',
                argDefaultValues: { project: project.id },
              })
            }
          >
            Create an editable copy
          </button>
        )
      }
    />
  )
}
