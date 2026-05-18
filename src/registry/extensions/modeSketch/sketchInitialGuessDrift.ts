import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals-core'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import {
  projectService,
  type SketchSolveScenePlugin,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  disposeInitialGuessUnderlay,
  INITIAL_GUESS_UNDERLAY_OBJECT_NAME,
  updateInitialGuessUnderlay,
} from './initialGuessUnderlay'

type InitialGuessDriftDebugSettings = SettingsType['debug'] & {
  showSketchInitialGuessDrift?: { current?: boolean }
}

const sketchInitialGuessDriftScenePlugin: SketchSolveScenePlugin = {
  id: INITIAL_GUESS_UNDERLAY_OBJECT_NAME,
  onSketchSceneGraphUpdate: updateInitialGuessUnderlay,
  onSketchScenePluginDispose: disposeInitialGuessUnderlay,
}

function shouldProvideSketchInitialGuessDriftPlugin(
  settings: SettingsType
): boolean {
  return (
    (settings.debug as InitialGuessDriftDebugSettings | undefined)
      ?.showSketchInitialGuessDrift?.current === true
  )
}

export const sketchInitialGuessDriftExtension = defineRegistryItemFactory(
  (ctx) => {
    const project = ctx.services.signal(projectService)
    const initialGuessDriftScenePlugin = computed(() =>
      project.value &&
      shouldProvideSketchInitialGuessDriftPlugin(project.value.settings.value)
        ? sketchInitialGuessDriftScenePlugin
        : null
    )

    return {
      item: defineRuntimeRegistryItem({
        id: 'mode-sketch.sketch-initial-guess-drift',
        provides: [
          provide(settingsValueSpec, {
            debug: {
              showSketchInitialGuessDrift: defineBooleanExtensionSetting({
                defaultValue: false,
                title: 'Show sketch initial guess drift',
                description:
                  'Whether to draw ghost points and dashed offsets from solver initial guesses to solved sketch points.',
                commandConfig: {
                  inputType: 'boolean',
                },
                userToml: {
                  sectionKey: 'debug',
                  tomlKey: 'show_sketch_initial_guess_drift',
                },
                projectToml: {
                  sectionKey: 'debug',
                  tomlKey: 'show_sketch_initial_guess_drift',
                },
              }),
            },
          }),
          provide(
            sketchSolveScenePluginsValueSpec,
            initialGuessDriftScenePlugin,
            {
              key: sketchInitialGuessDriftScenePlugin.id,
            }
          ),
        ],
      }),
    }
  },
  'mode-sketch.sketch-initial-guess-drift'
)
