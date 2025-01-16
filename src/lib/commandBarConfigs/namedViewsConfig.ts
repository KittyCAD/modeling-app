import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import { Command } from '../commandTypes'
import toast from 'react-hot-toast'
export function createNamedViewsCommand({ settingsState, settingsSend }) {
  const createNamedViewCommand: Command = {
    name: 'Create named view',
    displayName: `Create named view`,
    description: 'Create a named view to reload this view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: (data) => {
      const namedViews = [...settingsState.context.modeling.namedViews.current]
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
      toast.success('Deleted named view!')
    },
    args: {
      name: {
        required: true,
        inputType: 'options',
        options: () => {
          const namedViews = [
            ...settingsState.context.modeling.namedViews.current,
          ]
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
