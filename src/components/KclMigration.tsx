import { useSignals } from '@preact/signals-react/runtime'
import { KclMigrationDialog } from '@src/components/KclMigrationDialog'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import type { ZDSProject } from '@src/lang/KclManager'
import type { App } from '@src/lib/app'
import { MigrationController } from '@src/lib/kclMigration/controller'
import {
  isKcl2MigrationSource,
  migrationProject,
} from '@src/lib/kclMigration/project'
import { MIGRATION_FEATURE } from '@src/lib/kclMigration/protocol'
import type { AppHeaderItemProps } from '@src/registry/contracts/appHeader'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
      sourceIsKcl2={sourceIsKcl2}
      className={className}
    />
  )
}
