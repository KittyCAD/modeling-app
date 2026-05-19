import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { sketchInitialGuessDriftExtension } from '@src/registry/extensions/modeSketch/sketchInitialGuessDrift'
import { sketchDebuggerPaneExtension } from '@src/registry/extensions/modeSketch/sketchDebuggerPane'
import { sketchResidualsExtension } from '@src/registry/extensions/modeSketch/sketchResiduals'
import { isModeSketchDebugExtensionsAvailable } from '@src/registry/plugins/modeSketch/debugAvailability'

// Modes should be plugins that register everything they need in the design experience.
// Sketch residuals is mode-owned infrastructure; debug.showSketchResiduals controls whether it renders.
const debugExtensions = isModeSketchDebugExtensionsAvailable()
  ? [
      sketchResidualsExtension,
      sketchInitialGuessDriftExtension,
      sketchDebuggerPaneExtension,
    ]
  : []

const modeSketch = createZdsPlugin({
  id: 'mode-sketch',
  title: 'Sketch mode',
  description: 'Sketch mode design experience extensions.',
  items: debugExtensions,
  defaultSetting: 'core',
})

export default modeSketch
