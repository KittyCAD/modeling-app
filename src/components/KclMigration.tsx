import { useSignals } from '@preact/signals-react/runtime'
import { KclMigrationStart } from '@src/components/KclMigrationPanel'
import type { ZDSProject } from '@src/lib/projectSession'
import type { App } from '@src/lib/app'
import { MigrationController } from '@src/lib/kclMigration/controller'
import {
  watchMigrationSource,
  migrationProject,
} from '@src/lib/kclMigration/project'
import { MIGRATION_FEATURE } from '@src/lib/kclMigration/protocol'
import { kclMigrationService } from '@src/registry/contracts/kclMigration'
import { useEffect, useState } from 'react'

export function KclMigration({
  app,
  chatBusy,
  afterExchange,
}: {
  app: App
  chatBusy: boolean
  afterExchange: number
}) {
  useSignals()
  const project = app.projectSignal.value
  const enabled =
    app.userFeatures.contextSignal.value.featureIds.has(MIGRATION_FEATURE)
  if (!project) return null
  return (
    <ProjectMigration
      key={project.path}
      app={app}
      project={project}
      enabled={enabled}
      chatBusy={chatBusy}
      afterExchange={afterExchange}
    />
  )
}

function ProjectMigration({
  app,
  project,
  enabled,
  chatBusy,
  afterExchange,
}: {
  app: App
  project: ZDSProject
  enabled: boolean
  chatBusy: boolean
  afterExchange: number
}) {
  useSignals()
  const token = app.auth.token.value
  const [sourceIsKcl2, setSourceIsKcl2] = useState(false)
  useEffect(() => {
    if (enabled) return watchMigrationSource(app, project, setSourceIsKcl2)
  }, [app, project, enabled])
  const migration = app.registry.get(kclMigrationService)
  const controller = migration.controller.value
  useEffect(() => {
    migration.getOrCreate(
      project,
      () => new MigrationController(migrationProject(app, project), () => token)
    )
  }, [app, migration, project, token, controller])
  if (
    !controller ||
    !enabled ||
    !sourceIsKcl2 ||
    controller.busy ||
    controller.phase.value === 'recovery_required'
  )
    return null
  return (
    <KclMigrationStart
      disabled={chatBusy}
      onStart={() =>
        migration.start(
          project,
          () =>
            new MigrationController(
              migrationProject(app, project),
              () => token
            ),
          afterExchange
        )
      }
    />
  )
}
