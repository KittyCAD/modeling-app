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
  disposeResidualsUnderlay,
  updateResidualsUnderlay,
} from './residualsUnderlay'

type ResidualDebugSettings = SettingsType['debug'] & {
  showSketchResiduals?: { current?: boolean }
}

const sketchResidualsScenePlugin: SketchSolveScenePlugin = {
  id: 'sketch-residuals-underlay',
  onSketchSceneGraphUpdate: updateResidualsUnderlay,
  onSketchScenePluginDispose: disposeResidualsUnderlay,
}

function shouldProvideSketchResidualsPlugin(settings: SettingsType): boolean {
  return (
    (settings.debug as ResidualDebugSettings | undefined)?.showSketchResiduals
      ?.current === true
  )
}

export const sketchResidualsExtension = defineRegistryItemFactory((ctx) => {
  const project = ctx.services.signal(projectService)
  const residualsScenePlugin = computed(() =>
    project.value &&
    shouldProvideSketchResidualsPlugin(project.value.settings.value)
      ? sketchResidualsScenePlugin
      : null
  )

  return {
    item: defineRuntimeRegistryItem({
      id: 'mode-sketch.sketch-residuals',
      provides: [
        provide(settingsValueSpec, {
          debug: {
            showSketchResiduals: defineBooleanExtensionSetting({
              defaultValue: false,
              title: 'Show sketch residuals',
              description:
                'Whether to show a debug underlay visualizing sketch-solver residual fields.',
              commandConfig: {
                inputType: 'boolean',
              },
              userToml: {
                sectionKey: 'debug',
                tomlKey: 'show_sketch_residuals',
              },
              projectToml: {
                sectionKey: 'debug',
                tomlKey: 'show_sketch_residuals',
              },
            }),
          },
        }),
        provide(sketchSolveScenePluginsValueSpec, residualsScenePlugin, {
          key: sketchResidualsScenePlugin.id,
        }),
      ],
    }),
  }
}, 'mode-sketch.sketch-residuals')
