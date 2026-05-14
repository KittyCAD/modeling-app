import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { sketchDebuggerPaneExtension } from '@src/registry/extensions/modeSketch/sketchDebuggerPane'
import { sketchResidualsExtension } from '@src/registry/extensions/modeSketch/sketchResiduals'

// Modes should be plugins that register everything they need in the design experience.
// Sketch residuals is mode-owned infrastructure; debug.showSketchResiduals controls whether it renders.
const modeSketch = createZdsPlugin({
  id: 'mode-sketch',
  title: 'Sketch mode',
  description: 'Sketch mode design experience extensions.',
  items: [sketchResidualsExtension, sketchDebuggerPaneExtension],
  defaultSetting: 'core',
})

export default modeSketch
