import toast from 'react-hot-toast'

import type { KclManager } from '@src/lang/KclManager'
import { isMainKclPath } from '@src/lang/project'
import {
  addNamedViews,
  directedCameraFromNamedView,
} from '@src/lang/modifyAst/namedViews'
import { usesKclNamedViews } from '@src/lib/commandBarConfigs/namedViewsConfig'
import { err } from '@src/lib/trap'
import type { SettingsActorType } from '@src/machines/settingsMachine'

/**
 * The `main.kcl` paths migrated this session. A migration rewrites the code,
 * which parses it again and asks to migrate again before the cleared setting
 * has necessarily reached every reader; this keeps that from writing the
 * views twice.
 */
const migratedPaths = new Set<string>()

/**
 * Moves the named views a project still stores in `project.toml` into its
 * `main.kcl`, as one `view::named()` call each, then clears the setting.
 *
 * Runs only while `main.kcl` is open, parses, and uses KCL 3.0 or later, where
 * `view::named()` exists. Projects that do not meet that keep their views in
 * `project.toml`, where the named view commands still find them.
 *
 * Returns whether it migrated anything.
 */
export async function migrateProjectTomlNamedViews({
  kclManager,
  settingsActor,
}: {
  kclManager: KclManager
  settingsActor: SettingsActorType
}): Promise<boolean> {
  const path = kclManager.path
  const legacyViews = Object.values(
    settingsActor.getSnapshot().context.app.namedViews.current
  ).filter((view) => view !== undefined)

  if (
    legacyViews.length === 0 ||
    migratedPaths.has(path) ||
    !isMainKclPath(path) ||
    kclManager.hasParseErrors() ||
    !(await usesKclNamedViews(kclManager))
  ) {
    return false
  }

  // The checks above awaited, so the file may have changed under us.
  if (kclManager.path !== path || migratedPaths.has(path)) {
    return false
  }

  const result = addNamedViews({
    ast: kclManager.ast,
    views: legacyViews.map((view) => ({
      name: view.name,
      camera: directedCameraFromNamedView(view),
    })),
    wasmInstance: await kclManager.wasmInstancePromise,
  })
  if (err(result) || kclManager.path !== path || migratedPaths.has(path)) {
    return false
  }
  migratedPaths.add(path)

  // Undoing this would drop the views, since the setting is cleared below.
  await kclManager.updateEditorWithAstAndWriteToFile(result.modifiedAst, {
    shouldExecute: true,
    shouldAddToHistory: false,
  })

  // That update skips itself when the document changed meanwhile. Keep the
  // setting until the views have really reached the code.
  if (!result.names.every((name) => kclManager.code.includes(`"${name}"`))) {
    migratedPaths.delete(path)
    return false
  }

  settingsActor.send({
    type: 'set.app.namedViews',
    data: {
      level: 'project',
      value: {},
      toastCallback: () => {
        toast.success(
          result.names.length === 1
            ? `Moved named view "${result.names[0]}" from project.toml into main.kcl.`
            : `Moved ${result.names.length} named views from project.toml into main.kcl.`
        )
      },
    },
  })

  return true
}
