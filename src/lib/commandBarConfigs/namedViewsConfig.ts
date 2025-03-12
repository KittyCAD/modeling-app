import { NamedView } from '@rust/kcl-lib/bindings/NamedView'
import { Command, CommandArgumentOption } from '../commandTypes'
import toast from 'react-hot-toast'
import { engineCommandManager, sceneInfra } from 'lib/singletons'
import { uuidv4 } from 'lib/utils'
import { settingsActor } from 'machines/appMachine'
import { reportRejection } from 'lib/trap'

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
          const view = cameraGetViewResponse.resp.data.modeling_response.data
          // Create a new named view
          const requestedView: NamedView = {
            name: data.name,
            ...view.view,
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
        options: () => {
          const namedViews = {
            ...settingsActor.getSnapshot().context.app.namedViews.current,
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

          // Only send the specific camera information, the NamedView itself
          // is not directly compatible with the engine API
          await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              type: 'default_camera_set_view',
              view: {
                ...engineViewData,
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
          const namedViews = {
            ...settingsActor.getSnapshot().context.app.namedViews.current,
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
