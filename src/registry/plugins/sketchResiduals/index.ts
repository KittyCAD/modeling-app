import { defineRegistryItem, provide } from '@kittycad/registry'
import { defineBooleanExtensionSetting } from '@src/lib/settings/extensionSettings'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { sketchSolveScenePluginsValueSpec } from '@src/registry/contracts/sketchSolveScene'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { updateResidualsUnderlay } from './residualsUnderlay'

const sketchResidualsItem = defineRegistryItem({
  id: 'sketch-residuals-underlay',
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
    }),
  ],
})

const sketchResiduals = createZdsPlugin({
  id: 'sketch-residuals',
  title: 'Sketch residuals',
  description: 'Debug shader underlay for sketch-solver residual fields.',
  items: [sketchResidualsItem],
  defaultSetting: 'core',
})

export default sketchResiduals
