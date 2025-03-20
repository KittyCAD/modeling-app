import { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import { Command, CommandArgumentOption } from '../commandTypes'
import toast from 'react-hot-toast'
import { engineCommandManager, sceneInfra } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { settingsActor, getSettings } from 'machines/appMachine'
import { err, reportRejection } from 'lib/trap'
import {
  CameraViewState_type,
  DefaultCameraGetView_type,
  WorldCoordinateSystem_type,
} from '@kittycad/lib/dist/types/src/models'

function isWorldCoordinateSystemType(
  x: string
): x is WorldCoordinateSystem_type {
  return x === 'right_handed_up_z' || x === 'right_handed_up_y'
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
    pivot_position: namedView.pivot_position,
    pivot_rotation: namedView.pivot_rotation,
  }

  return cameraViewState
}

function cameraViewStateToNamedView(
  name: string,
  cameraViewState: CameraViewState_type
): NamedView | Error {
  let pivot_position: [number, number, number] | null = null
  let pivot_rotation: [number, number, number, number] | null = null

  if (cameraViewState.pivot_position.length === 3) {
    pivot_position = [
      cameraViewState.pivot_position[0],
      cameraViewState.pivot_position[1],
      cameraViewState.pivot_position[2],
    ]
  } else {
    return new Error(`invalid pivot position ${cameraViewState.pivot_position}`)
  }

  if (cameraViewState.pivot_rotation.length === 4) {
    pivot_rotation = [
      cameraViewState.pivot_rotation[0],
      cameraViewState.pivot_rotation[1],
      cameraViewState.pivot_rotation[2],
      cameraViewState.pivot_rotation[3],
    ]
  } else {
    return new Error(`invalid pivot rotation ${cameraViewState.pivot_rotation}`)
  }

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
    version: -1,
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

        if (!(cameraGetViewResponse && 'resp' in cameraGetViewResponse)) {
          return toast.error('Unable to create named view, websocket failure')
        }

        if ('modeling_response' in cameraGetViewResponse.resp.data) {
          if (cameraGetViewResponse.success) {
            if (
              cameraGetViewResponse.resp.data.modeling_response.type ===
              'default_camera_get_view'
            ) {
              const view =
                cameraGetViewResponse.resp.data.modeling_response.data
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
