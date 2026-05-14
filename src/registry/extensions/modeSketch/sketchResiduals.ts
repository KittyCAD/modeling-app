import { defineRegistryItem, provide } from '@kittycad/registry'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { sketchSolveScenePluginsValueSpec } from '@src/registry/contracts/project'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import {
  disposeResidualsUnderlay,
  updateResidualsUnderlay,
} from './residualsUnderlay'

export const sketchResidualsExtension = defineRegistryItem({
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
    provide(sketchSolveScenePluginsValueSpec, {
      id: 'sketch-residuals-underlay',
      onSketchSceneGraphUpdate: updateResidualsUnderlay,
      onSketchScenePluginDispose: disposeResidualsUnderlay,
    }),
  ],
})
