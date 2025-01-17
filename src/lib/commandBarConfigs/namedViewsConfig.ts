import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import { Command } from '../commandTypes'
import toast from 'react-hot-toast'
export function createNamedViewsCommand({
  settingsState,
  settingsSend,
  settingsActor,
}) {
  const createNamedViewCommand: Command = {
    name: 'Create named view',
    displayName: `Create named view`,
    description: 'Create a named view to reload this view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const namedViews = [
        ...settingsActor.getSnapshot().context.modeling.namedViews.current,
      ]
      // Get the value of the flow
      // Get all the current ones
      // Set it as a setting
      // send()
      const requestedView: NamedView = {
        name: data.name,
        fov: 1,
        near: 2,
        far: 3,
        position: [1, 2, 3],
        orientation: [1, 2, 3, 4],
      }

      const requestedNamedViews = [...namedViews, requestedView]
      settingsSend({
        type: `set.modeling.namedViews`,
        data: {
          level: 'project',
          value: requestedNamedViews,
        },
      })

      // TODO: duplicate
      // TODO: overwrite
      // TODO: ask them to rename?
      toast.success(
        `Your named view ${requestedView.name} successfully created.`
      )
    },
    args: {
      name: {
        required: true,
        inputType: 'string',
      },
    },
  }

  const deleteNamedViewCommand: Command = {
    name: 'Delete named view',
    displayName: `Delete named view`,
    description: 'Delete a named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const nameToDelete = data.name
      const namedViews = [
        ...settingsActor.getSnapshot().context.modeling.namedViews.current,
      ]
      const indexToDelete = namedViews.findIndex(
        (view) => view.name === nameToDelete
      )
      if (indexToDelete >= 0) {
        namedViews.splice(indexToDelete, 1)
        settingsSend({
          type: `set.modeling.namedViews`,
          data: {
            level: 'project',
            value: namedViews,
          },
        })
        toast.success(`Deleted ${data.name} named view.`)
      } else {
        toast.error(`Unable to delete ${data.name}, something went wrong.`)
      }
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => {
          const namedViews = [
            ...settingsActor.getSnapshot().context.modeling.namedViews.current,
          ]
          console.log('LOADING VIEWS!', namedViews)
          return namedViews.map((view, index) => {
            return {
              name: view.name,
              isCurrent: index === 0,
              value: view.name,
            }
          })
        },
      },
    },
  }

  return { createNamedViewCommand, deleteNamedViewCommand }
}
