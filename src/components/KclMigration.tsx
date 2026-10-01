import { useSignals } from '@preact/signals-react/runtime'
import { KclMigrationPanel } from '@src/components/KclMigrationPanel'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import type { ZDSProject } from '@src/lang/KclManager'
import type { App } from '@src/lib/app'
import { MigrationController } from '@src/lib/kclMigration/controller'
import {
  isKcl2MigrationSource,
  migrationProject,
} from '@src/lib/kclMigration/project'
import { MIGRATION_FEATURE } from '@src/lib/kclMigration/protocol'
import { kclMigrationService } from '@src/registry/contracts/kclMigration'
import { useCallback, useEffect, useMemo, useState } from 'react'

export function KclMigration({
  app,
  chatBusy,
}: {
  app: App
  chatBusy: boolean
}) {
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
      chatBusy={chatBusy}
    />
  )
}

function ProjectMigration({
  app,
  project,
  enabled,
  chatBusy,
}: {
  app: App
  project: ZDSProject
  enabled: boolean
  chatBusy: boolean
}) {
  useSignals()
  const token = app.auth.token.value
  const projectInfo = project.projectIORefSignal.value
  const executingPath = project.executingPath
  const entrypointCode = project.findEditor(projectInfo.default_file)?.[1]
    .codeSignal.value
  const [sourceIsKcl2, setSourceIsKcl2] = useState(false)
  const [diskRevision, setDiskRevision] = useState(0)
  const watchPaths = useMemo(
    () => [projectInfo.default_file],
    [projectInfo.default_file]
  )
  const onFileChange = useCallback(async () => {
    setDiskRevision((revision) => revision + 1)
  }, [])
  useFileSystemWatcher(onFileChange, watchPaths)
  useEffect(() => {
    let current = true
    setSourceIsKcl2(false)
    if (enabled) {
      const check = async () => {
        const source =
          entrypointCode ??
          new TextDecoder('utf-8', { fatal: true }).decode(
            await app.fileOperations.readFile(projectInfo.default_file)
          )
        const wasm = await app.wasmPromise
        if (current) setSourceIsKcl2(isKcl2MigrationSource(source, wasm))
      }
      check().catch(() => {
        if (current) setSourceIsKcl2(false)
      })
    }
    return () => {
      current = false
    }
  }, [app, projectInfo, entrypointCode, executingPath, diskRevision, enabled])
  const migration = app.registry.get(kclMigrationService)
  const controller = migration.controller.value
  useEffect(() => {
    migration.getOrCreate(
      project,
      () => new MigrationController(migrationProject(app, project), () => token)
    )
  }, [app, migration, project, token])
  if (!controller) return null
  return (
    <KclMigrationPanel
      controller={controller}
      enabled={enabled}
      sourceIsKcl2={sourceIsKcl2}
      chatBusy={chatBusy}
    />
  )
}
