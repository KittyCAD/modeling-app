import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import { Command } from '../commandTypes'
import toast from 'react-hot-toast'
import { engineCommandManager } from 'lib/singletons'
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
    description: 'Create a named view to reload this view',
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
            // @ts-ignore Not in production yet.
            cmd: { type: 'default_camera_get_view' },
          })

        if (!cameraGetViewResponse) {
          return toast.error('Unable to create named view, websocket failure')
        }

        const view = cameraGetViewResponse.resp.data.modeling_response.data

        // Create a new named view
        const requestedView: NamedView = {
          name: data.name,
          ...view.view,
        }
        // Retrieve application state for namedViews
        const namedViews = [
          ...settingsActor.getSnapshot().context.app.namedViews.current,
        ]

        // Create and set namedViews application state
        const requestedNamedViews = [...namedViews, requestedView]
        settingsActor.send({
          type: `set.app.namedViews`,
          data: {
            level: 'project',
            value: requestedNamedViews,
          },
        })
        toast.success(
          `Your named view ${requestedView.name} successfully created.`
        )
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
    description: 'Delete a named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      if (!data) {
        return toast.error('Unable to delete named view, missing name')
      }
      const nameToDelete = data.name
      // Retrieve application state for namedViews
      const namedViews = [
        ...settingsActor.getSnapshot().context.app.namedViews.current,
      ]

      // Find the named view in the array
      const indexToDelete = namedViews.findIndex(
        (view) => view.name === nameToDelete
      )
      if (indexToDelete >= 0) {
        const name = namedViews[indexToDelete].name

        // Remove the named view from the array
        namedViews.splice(indexToDelete, 1)

        // Update global state with the new computed state
        settingsActor.send({
          type: `set.app.namedViews`,
          data: {
            level: 'project',
            value: namedViews,
          },
        })
        toast.success(`Deleted ${name} named view`)
      } else {
        toast.error(`Unable to delete, could not find the named view`)
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => {
          const namedViews = [
            ...settingsActor.getSnapshot().context.app.namedViews.current,
          ]
          return namedViews.map((view, index) => {
            return {
              name: view.name,
              isCurrent: false,
              value: view.name,
            }
          })
        },
      },
    },
  }

  // Read the named view from settings state and pass that camera information to the engine command to set the view of the engine camera
  const loadNamedViewCommand: Command = {
    name: 'Load named view',
    displayName: `Load named view`,
    description: 'Load a named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const invokeAndForgetLoadNamedView = async () => {
        if (!data) {
          return toast.error('Unable to load named view')
        }

        // Retrieve application state for namedViews
        const namedViews = [
          ...settingsActor.getSnapshot().context.app.namedViews.current,
        ]
        const _idToLoad = data.name
        const viewToLoad = namedViews.find((view) => view.id === _idToLoad)
        if (viewToLoad) {
          // Split into the name and the engine data
          const { name, id, version, ...engineViewData } = viewToLoad

          // Only send the specific camera information, the NamedView itself
          // is not directly compatible with the engine API
          await engineCommandManager.sendSceneCommand({
            type: 'modeling_cmd_req',
            cmd_id: uuidv4(),
            cmd: {
              // @ts-ignore Not in production yet.
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

          toast.success(`Loaded ${name} named view`)
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
          const namedViews = [
            ...settingsActor.getSnapshot().context.app.namedViews.current,
          ]
          return namedViews.map((view) => {
            return {
              name: view.name,
              isCurrent: false,
              value: view.id,
            }
          })
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
