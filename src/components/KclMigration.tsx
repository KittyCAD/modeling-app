import { useSignals } from '@preact/signals-react/runtime'
import { KclMigrationDialog } from '@src/components/KclMigrationDialog'
import type { ZDSProject } from '@src/lang/KclManager'
import type { App } from '@src/lib/app'
import { MigrationController } from '@src/lib/kclMigration/controller'
import { migrationProject } from '@src/lib/kclMigration/project'
import { MIGRATION_FEATURE } from '@src/lib/kclMigration/protocol'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { useEffect, useState } from 'react'

export function KclMigrationHeaderItem({ app, className }: AppHeaderItemProps) {
  useSignals()
  const project = app.projectSignal.value
  // Compare runtime IDs until the SDK publishes the new Feature union member.
  const enabled = [...app.userFeatures.contextSignal.value.featureIds].some(
    (id: string) => id === MIGRATION_FEATURE
  )
  if (!project) return null
  return (
    <ProjectMigration
      key={project.path}
      app={app}
      project={project}
      enabled={enabled}
      className={className}
    />
  )
}

function ProjectMigration({
  app,
  project,
  enabled,
  className,
}: {
  app: App
  project: ZDSProject
  enabled: boolean
  className: string
}) {
  useSignals()
  const token = app.auth.token.value
  const [controller, setController] = useState<MigrationController>()
  useEffect(() => {
    const owned = new MigrationController(
      migrationProject(app, project),
      () => token
    )
    setController(owned)
    return () => owned.dispose()
  }, [app, project, token])
  if (!controller) return null
  return (
    <KclMigrationDialog
      controller={controller}
      enabled={enabled}
      className={className}
    />
  )
}
