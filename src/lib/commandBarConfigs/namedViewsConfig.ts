import type {
  CameraViewState_type,
  Point3d_type,
  Point4d_type,
  WorldCoordinateSystem_type,
} from '@kittycad/lib/dist/types/src/models'
import toast from 'react-hot-toast'

import type { NamedView } from '@rust/kcl-lib/bindings/NamedView'

import type { Command, CommandArgumentOption } from '@src/lib/commandTypes'
import { engineCommandManager } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import { getSettings, settingsActor } from '@src/machines/appMachine'

function isWorldCoordinateSystemType(
  x: string
): x is WorldCoordinateSystem_type {
  return x === 'right_handed_up_z' || x === 'right_handed_up_y'
}

type Tuple3 = [number, number, number]
type Tuple4 = [number, number, number, number]

function point3DToNumberArray(value: Point3d_type): Tuple3 {
  return [value.x, value.y, value.z]
}
function numberArrayToPoint3D(value: Tuple3): Point3d_type {
  return {
    x: value[0],
    y: value[1],
    z: value[2],
  }
}
function point4DToNumberArray(value: Point4d_type): Tuple4 {
  return [value.x, value.y, value.z, value.w]
}
function numberArrayToPoint4D(value: Tuple4): Point4d_type {
  return {
    x: value[0],
    y: value[1],
    z: value[2],
    w: value[3],
  }
}

function namedViewToCameraViewState(
  namedView: NamedView
): CameraViewState_type | Error {
  const worldCoordinateSystem: string = namedView.world_coord_system

  if (!isWorldCoordinateSystemType(worldCoordinateSystem)) {
    return new Error('world coordinate system is not typed')
  }

  const cameraViewState: CameraViewState_type = {
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

function cameraViewStateToNamedView(
  name: string,
  cameraViewState: CameraViewState_type
): NamedView | Error {
  let pivot_position: Tuple3 | null = null
  let pivot_rotation: Tuple4 | null = null

  pivot_position = point3DToNumberArray(cameraViewState.pivot_position)
  pivot_rotation = point4DToNumberArray(cameraViewState.pivot_rotation)

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

export function createNamedViewsCommand() {
  // Creates a command to be registered in the command bar.
  // The createNamedViewsCommand will prompt the user for a name and then
  // hit the engine for the camera properties and write them back to disk
  // in project.toml.
  const createNamedViewCommand: Command = {
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
          return toast.error('Unable to create named view, missing name')
        }

        // Retrieve camera view state from the engine
        const cameraGetViewResponse =
          await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: { type: 'default_camera_get_view' },
          })

        if (
          !(
            cameraGetViewResponse &&
            cameraGetViewResponse.success &&
            'resp' in cameraGetViewResponse
          )
        ) {
          return toast.error('Unable to create named view, websocket failure')
        }

        if ('modeling_response' in cameraGetViewResponse.resp.data) {
          if (
            cameraGetViewResponse.resp.data.modeling_response.type ===
            'default_camera_get_view'
          ) {
            const view = cameraGetViewResponse.resp.data.modeling_response.data
            const requestedView = cameraViewStateToNamedView(
              data.name,
              view.view
            )
            if (err(requestedView)) {
              toast.error('Unable to create named view.')
              return
            }
            // Retrieve application state for namedViews
            const namedViews = {
              ...settingsActor.getSnapshot().context.app.namedViews.current,
            }

            // Create and set namedViews application state
            const uniqueUuidV4 = uuidv4()
            const requestedNamedViews = {
              ...namedViews,
              [uniqueUuidV4]: requestedView,
            }
            settingsActor.send({
              type: `set.app.namedViews`,
              data: {
                level: 'project',
                value: requestedNamedViews,
              },
            })

            toast.success(`Named view ${requestedView.name} created.`)
          }
        }
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

  // Given a named view selection from the command bar, this will
  // find it in the setting state, remove it from the array and
  // rewrite the project.toml settings to disk to delete the named view
  const deleteNamedViewCommand: Command = {
    name: 'Delete named view',
    displayName: `Delete named view`,
    description: 'Deletes the named view from settings',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      if (!data) {
        return toast.error('Unable to delete named view, missing name')
      }
      const idToDelete = data.name

      // Retrieve application state for namedViews

      const namedViews = {
        ...settingsActor.getSnapshot().context.app.namedViews.current,
      }

      const { [idToDelete]: viewToDelete, ...rest } = namedViews

      // Find the named view in the array
      if (idToDelete && viewToDelete) {
        // Update global state with the new computed state
        settingsActor.send({
          type: `set.app.namedViews`,
          data: {
            level: 'project',
            value: rest,
          },
        })
        toast.success(`Named view ${viewToDelete.name} removed.`)
      } else {
        toast.error(`Unable to delete, could not find the named view`)
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: (commandBar, machineContext) => {
          const settings = getSettings()
          const namedViews = {
            ...settings.app.namedViews.current,
          }
          const options: CommandArgumentOption<any>[] = []
          Object.entries(namedViews).forEach(([key, view]) => {
            if (view) {
              options.push({
                name: view.name,
                isCurrent: false,
                value: key,
              })
            }
          })
          return options
        },
      },
    },
  }

  // Read the named view from settings state and pass that camera information to the engine command to set the view of the engine camera
  const loadNamedViewCommand: Command = {
    name: 'Load named view',
    displayName: `Load named view`,
    description: 'Loads your camera to the named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const invokeAndForgetLoadNamedView = async () => {
        if (!data) {
          return toast.error('Unable to load named view')
        }

        // Retrieve application state for namedViews
        const namedViews = {
          ...settingsActor.getSnapshot().context.app.namedViews.current,
        }

        const idToLoad = data.name
        const viewToLoad = namedViews[idToLoad]
        if (viewToLoad) {
          // Split into the name and the engine data
          const { name, version, ...engineViewData } = viewToLoad
          const cameraViewState = namedViewToCameraViewState(viewToLoad)

          if (err(cameraViewState)) {
            toast.error(`Unable to load named view ${data.name}`)
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

          const isPerpsective = !engineViewData.is_ortho

          // Update the GUI for orthographic and projection
          settingsActor.send({
            type: 'set.modeling.cameraProjection',
            data: {
              level: 'user',
              value: isPerpsective ? 'perspective' : 'orthographic',
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
          toast.success(`Named view ${name} loaded.`)
        } else {
          toast.error(`Unable to load named view, could not find named view`)
        }
      }
      invokeAndForgetLoadNamedView().catch(reportRejection)
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => {
          const settings = getSettings()
          const namedViews = {
            ...settings.app.namedViews.current,
          }
          const options: CommandArgumentOption<any>[] = []
          Object.entries(namedViews).forEach(([key, view]) => {
            if (view) {
              options.push({
                name: view.name,
                isCurrent: false,
                value: key,
              })
            }
          })
          return options
        },
      },
    },
  }

  return {
    createNamedViewCommand,
    deleteNamedViewCommand,
    loadNamedViewCommand,
  }
}
