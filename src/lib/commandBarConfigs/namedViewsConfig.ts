import type {
  CameraViewState,
  Point3d,
  Point4d,
  WorldCoordinateSystem,
} from '@kittycad/lib'
import toast from 'react-hot-toast'

import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'

import type { KclManager } from '@src/lang/KclManager'
import { programUsesKclV3 } from '@src/lang/kclLanguageVersion'
import { updateModelingState } from '@src/lang/modelingWorkflows'
import {
  addNamedViews,
  directedCameraFromNamedView,
} from '@src/lang/modifyAst/namedViews'
import type { KclNamedView } from '@src/lang/std/kclNamedViews'
import { listNamedViews } from '@src/lang/std/kclNamedViews'
import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { EXECUTION_TYPE_REAL } from '@src/lib/constants'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import {
  activateNamedView,
  hasNamedViewsUi,
} from '@src/lib/kclNamedViewActivation'
import { applyNamedViewCamera } from '@src/lib/kclNamedViewCamera'
import { sendDeleteCommand } from '@src/lib/featureTree'
import { err, isErr, reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import { MODE_MODELING_COMMAND_SCOPE } from '@src/registry/contracts/commands'

function isWorldCoordinateSystemType(x: string): x is WorldCoordinateSystem {
  return x === 'right_handed_up_z' || x === 'right_handed_up_y'
}

type Tuple3 = [number, number, number]
type Tuple4 = [number, number, number, number]

function point3DToNumberArray(value: Point3d): Tuple3 {
  return [value.x, value.y, value.z]
}
function numberArrayToPoint3D(value: Tuple3): Point3d {
  return {
    x: value[0],
    y: value[1],
    z: value[2],
  }
}
function point4DToNumberArray(value: Point4d): Tuple4 {
  return [value.x, value.y, value.z, value.w]
}
function numberArrayToPoint4D(value: Tuple4): Point4d {
  return {
    x: value[0],
    y: value[1],
    z: value[2],
    w: value[3],
  }
}

function namedViewToCameraViewState(
  namedView: NamedView
): CameraViewState | Error {
  const worldCoordinateSystem: string = namedView.world_coord_system

  if (!isWorldCoordinateSystemType(worldCoordinateSystem)) {
    return new Error('world coordinate system is not typed')
  }

  const cameraViewState: CameraViewState = {
    eye_offset: namedView.eye_offset,
    fov_y: namedView.fov_y,
    ortho_scale_enabled: namedView.ortho_scale_enabled,
    ortho_scale_factor: namedView.ortho_scale_factor,
    world_coord_system: worldCoordinateSystem,
    is_ortho: namedView.is_ortho,
    pivot_position: numberArrayToPoint3D(namedView.pivot_position),
    pivot_rotation: numberArrayToPoint4D(namedView.pivot_rotation),
  }

  return cameraViewState
}

export function cameraViewStateToNamedView(
  name: string,
  cameraViewState: CameraViewState
): NamedView | Error {
  const pivot_position = point3DToNumberArray(cameraViewState.pivot_position)
  const pivot_rotation = point4DToNumberArray(cameraViewState.pivot_rotation)

  // Create a new named view
  const requestedView: NamedView = {
    name,
    eye_offset: cameraViewState.eye_offset,
    fov_y: cameraViewState.fov_y,
    ortho_scale_enabled: cameraViewState.ortho_scale_enabled,
    ortho_scale_factor: cameraViewState.ortho_scale_factor,
    world_coord_system: cameraViewState.world_coord_system,
    is_ortho: cameraViewState.is_ortho,
    pivot_position,
    pivot_rotation,
    // TS side knows about the version for the time being the version is not used for anything for now.
    // Can be detected and cleaned up later if we have new version.
    version: 1.0,
  }

  return requestedView
}

/**
 * Whether named views of the open file live in KCL. They do from KCL 3.0 on,
 * where `view::named()` exists. Older files keep using the deprecated
 * `project.toml` setting until they are upgraded.
 */
export async function usesKclNamedViews(
  kclManager: KclManager
): Promise<boolean> {
  const wasmInstance = await kclManager.wasmInstancePromise
  return programUsesKclV3(kclManager.ast, wasmInstance)
}

/** Every view the last execution produced, in every module. */
function executedViews(kclManager: KclManager): KclNamedView[] {
  return listNamedViews({
    artifactGraph: kclManager.execState.artifactGraph,
    filenames: kclManager.execState.filenames,
  })
}

/** Views the open file declares itself, which are the ones it can delete. */
function viewsDeclaredInOpenFile(kclManager: KclManager): KclNamedView[] {
  // The open file is the root module, whose id is always 0.
  return executedViews(kclManager).filter((view) => view.moduleId === 0)
}

function kclViewOptions(views: KclNamedView[]): CommandArgumentOption<any>[] {
  return views.map((view) => ({
    name: view.artifact.name,
    isCurrent: false,
    value: view.artifact.id,
  }))
}

function legacyViewOptions(
  settingsActor: SettingsActorType
): CommandArgumentOption<any>[] {
  const namedViews = settingsActor.getSnapshot().context.app.namedViews.current
  const options: CommandArgumentOption<any>[] = []
  Object.entries(namedViews).forEach(([key, view]) => {
    if (view) {
      options.push({ name: view.name, isCurrent: false, value: key })
    }
  })
  return options
}

/**
 * Moves the engine camera to a named view saved in the project settings and
 * syncs the client side camera and projection setting with it.
 *
 * @deprecated Only for files older than KCL 3.0. Newer files store named views
 * in KCL.
 */
async function loadLegacyNamedView({
  view,
  engineCommandManager,
  settingsActor,
}: {
  view: NamedView
  engineCommandManager: ConnectionManager
  settingsActor: SettingsActorType
}): Promise<void> {
  const cameraViewState = namedViewToCameraViewState(view)

  if (err(cameraViewState)) {
    toast.error(`Unable to load named view ${view.name}.`)
    return
  }

  // Only send the specific camera information, the NamedView itself
  // is not directly compatible with the engine API
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_set_view',
      view: {
        ...cameraViewState,
      },
    },
  })

  const isPerspective = !view.is_ortho

  // Update the GUI for orthographic and projection
  settingsActor.send({
    type: 'set.modeling.cameraProjection',
    data: {
      level: 'user',
      value: isPerspective ? 'perspective' : 'orthographic',
    },
  })

  // Update the camera by triggering the callback workflow to get the camera settings
  // Setting the view won't update the client side camera.
  // Asking for the default camera settings after setting the view will internally sync the camera
  await engineCommandManager.sendSceneCommand({
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'default_camera_get_settings',
    },
  })

  // We do not have the promise of the engine command for ensuring the camera projection has been completed.
  toast.success(`Named view ${view.name} loaded.`)
}

/**
 * Moves the camera to a KCL named view. With the Views pane enabled this is
 * the same activation the pane performs, visibility included; without it, only
 * the camera moves.
 */
async function loadKclNamedView(
  kclManager: KclManager,
  view: KclNamedView
): Promise<void> {
  if (hasNamedViewsUi()) {
    await activateNamedView({
      target: { kind: 'declared', view },
      kclManager,
    })
  } else {
    await applyNamedViewCamera({
      camera: view.artifact.camera,
      sceneInfra: kclManager.sceneInfra,
      engineCommandManager: kclManager.engineCommandManager,
    })
  }
  toast.success(`Named view ${view.artifact.name} loaded.`)
}

export function createNamedViewsCommand(
  kclManager: KclManager,
  settingsActor: SettingsActorType
) {
  const engineCommandManager = kclManager.engineCommandManager

  // Prompts for a name, reads the camera from the engine, and appends a
  // `view::named()` call to the open file. Files older than KCL 3.0 store the
  // view in project.toml instead.
  const createNamedViewCommand: Command = {
    scopes: [MODE_MODELING_COMMAND_SCOPE],
    name: 'Create named view',
    displayName: `Create named view`,
    description:
      'Saves a named view based on your current view to load again later',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const invokeAndForgetCreateNamedView = async () => {
        if (!data) {
          return toast.error('Unable to create named view, missing name.')
        }

        const view = await kclManager.sceneInfra.camControls.getCameraView()
        if (err(view)) {
          return toast.error('Unable to create named view, websocket failure.')
        }

        const requestedView = cameraViewStateToNamedView(data.name, view)
        if (err(requestedView)) {
          toast.error('Unable to create named view.')
          return
        }

        if (await usesKclNamedViews(kclManager)) {
          const result = addNamedViews({
            ast: kclManager.ast,
            views: [
              {
                name: requestedView.name,
                camera: directedCameraFromNamedView(requestedView),
              },
            ],
            wasmInstance: await kclManager.wasmInstancePromise,
          })
          if (err(result)) {
            toast.error('Unable to create named view.')
            return
          }
          try {
            await updateModelingState(
              result.modifiedAst,
              EXECUTION_TYPE_REAL,
              kclManager,
              { focusPath: [result.pathToNode] }
            )
          } catch (e) {
            toast.error(
              `Unable to create named view: ${isErr(e) ? e.message : String(e)}`
            )
            return
          }
          toast.success(`Named view ${result.names[0]} created.`)
          return
        }

        const namedViews = {
          ...settingsActor.getSnapshot().context.app.namedViews.current,
          [uuidv4()]: requestedView,
        }
        settingsActor.send({
          type: `set.app.namedViews`,
          data: {
            level: 'project',
            value: namedViews,
            toastCallback: () => {
              toast.success(`Named view ${requestedView.name} created.`)
            },
          },
        })
      }
      invokeAndForgetCreateNamedView().catch(reportRejection)
    },
    args: {
      name: {
        required: true,
        inputType: 'string',
      },
    },
  }

  // Removes the `view::named()` call of the chosen view from the open file,
  // or, for files older than KCL 3.0, the view from project.toml.
  const deleteNamedViewCommand: Command = {
    scopes: [MODE_MODELING_COMMAND_SCOPE],
    name: 'Delete named view',
    displayName: `Delete named view`,
    description: 'Deletes a named view of this file',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const invokeAndForgetDeleteNamedView = async () => {
        if (!data) {
          return toast.error('Unable to delete named view, missing name.')
        }
        const idToDelete = data.name

        const kclView = viewsDeclaredInOpenFile(kclManager).find(
          (view) => view.artifact.id === idToDelete
        )
        if (kclView) {
          // The same deletion the Feature Tree performs for this view.
          try {
            await sendDeleteCommand({
              artifact: kclManager.artifactGraph.get(kclView.artifact.id),
              targetSourceRange: kclView.artifact.codeRef.range,
              systemDeps: {
                kclManager,
                rustContext: kclManager.rustContext,
                sceneEntitiesManager: kclManager.sceneEntitiesManager,
              },
            })
          } catch (e) {
            toast.error(isErr(e) ? e.message : String(e))
            return
          }
          toast.success(`Named view ${kclView.artifact.name} removed.`)
          return
        }

        const namedViews = {
          ...settingsActor.getSnapshot().context.app.namedViews.current,
        }
        const { [idToDelete]: viewToDelete, ...rest } = namedViews
        if (!viewToDelete) {
          return toast.error(`Unable to delete, could not find the named view.`)
        }

        settingsActor.send({
          type: `set.app.namedViews`,
          data: {
            level: 'project',
            value: rest,
            toastCallback: () => {
              toast.success(`Named view ${viewToDelete.name} removed.`)
            },
          },
        })
      }
      invokeAndForgetDeleteNamedView().catch(reportRejection)
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => [
          ...kclViewOptions(viewsDeclaredInOpenFile(kclManager)),
          ...legacyViewOptions(settingsActor),
        ],
      },
    },
  }

  // Moves the camera to the chosen view: any view the last execution produced,
  // or a view still stored in project.toml by a file older than KCL 3.0.
  const loadNamedViewCommand: Command = {
    scopes: [MODE_MODELING_COMMAND_SCOPE],
    name: 'Load named view',
    displayName: `Load named view`,
    description: 'Loads your camera to the named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const invokeAndForgetLoadNamedView = async () => {
        if (!data) {
          return toast.error('Unable to load named view.')
        }
        const idToLoad = data.name

        const kclView = executedViews(kclManager).find(
          (view) => view.artifact.id === idToLoad
        )
        if (kclView) {
          await loadKclNamedView(kclManager, kclView)
          return
        }

        const legacyView =
          settingsActor.getSnapshot().context.app.namedViews.current[idToLoad]
        if (!legacyView) {
          return toast.error(
            `Unable to load named view, could not find named view.`
          )
        }

        await loadLegacyNamedView({
          view: legacyView,
          engineCommandManager,
          settingsActor,
        })
      }
      invokeAndForgetLoadNamedView().catch(reportRejection)
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => [
          ...kclViewOptions(executedViews(kclManager)),
          ...legacyViewOptions(settingsActor),
        ],
      },
    },
  }

  return {
    createNamedViewCommand,
    deleteNamedViewCommand,
    loadNamedViewCommand,
  }
}
