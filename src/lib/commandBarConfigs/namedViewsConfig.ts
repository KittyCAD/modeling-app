import { NamedView } from 'wasm-lib/kcl/bindings/NamedView'
import { Command } from '../commandTypes'
import toast from 'react-hot-toast'
import { engineCommandManager, sceneInfra } from 'lib/singletons'
import { convertThreeCamValuesToEngineCam } from 'clientSideScene/CameraControls'
import { uuidv4 } from 'lib/utils'
import { Vector3, Quaternion } from 'three'
import { settingsActor } from 'machines/appMachine'

export function createNamedViewsCommand() {
  const createNamedViewCommand: Command = {
    name: 'Create named view',
    displayName: `Create named view`,
    description: 'Create a named view to reload this view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: async (data) => {
      const namedViews = [
        ...settingsActor.getSnapshot().context.modeling.namedViews.current,
      ]
      var a = await engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: { type: 'default_camera_get_view' },
      })
      var view = a.resp.data.modeling_response.data
      const requestedView: NamedView = {
        name: data.name,
        ...view.view,
      }

      const requestedNamedViews = [...namedViews, requestedView]
      settingsActor.send({
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
        settingsActor.send({
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

  const loadNamedViewCommand: Command = {
    name: 'Load named view',
    displayName: `Load named view`,
    description: 'Load a named view',
    groupId: 'namedViews',
    icon: 'settings',
    needsReview: false,
    onSubmit: async (data) => {
      const nameToLoad = data.name
      const namedViews = [
        ...settingsActor.getSnapshot().context.modeling.namedViews.current,
      ]
      console.log('NAMED VIEWS?', namedViews)
      const viewToLoad = namedViews.find((view) => view.name === nameToLoad)
      if (viewToLoad) {
        const cameraViewData = { ...viewToLoad }
        delete cameraViewData.name
        console.log(cameraViewData, 'gonna load')
        await engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'default_camera_set_view',
            view: {
              ...cameraViewData,
            },
          },
        })
        toast.success(`Loaded ${data.name} named view.`)
      } else {
        toast.error(`Unable to load ${data.name}, something went wrong.`)
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

  return {
    createNamedViewCommand,
    deleteNamedViewCommand,
    loadNamedViewCommand,
  }
}
