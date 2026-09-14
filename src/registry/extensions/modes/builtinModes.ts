import { defineRegistryItem } from '@kittycad/registry'
import {
  MODE_MODELING_KEYMAP_SCOPE,
  MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
  MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
  MODE_SKETCHING_KEYMAP_SCOPE,
} from '@src/registry/contracts/keymap'
import { provideMode } from '@src/registry/contracts/modes'
import { lazy } from 'react'

// All built-in modes share the same component identity so the interaction canvas
// stays mounted while the modeling machine enters and exits a sketch.
export const BuiltInModeScene = lazy(async () => {
  const { BuiltInModeScene } = await import('./BuiltInModeScene')
  return { default: BuiltInModeScene }
})

export default defineRegistryItem({
  id: 'builtin-modes',
  provides: [
    provideMode({
      id: 'modeling',
      label: 'Modeling',
      toolbar: 'modeling',
      Scene: BuiltInModeScene,
      keymapScope: MODE_MODELING_KEYMAP_SCOPE,
    }),
    provideMode({
      id: 'onlyCancel',
      label: 'Sketch',
      toolbar: 'onlyCancel',
      Scene: BuiltInModeScene,
      keymapScope: MODE_SKETCH_NO_FACE_KEYMAP_SCOPE,
      selectable: false,
    }),
    provideMode({
      id: 'sketching',
      label: 'Sketch',
      icon: 'sketch',
      toolbar: 'sketching',
      Scene: BuiltInModeScene,
      keymapScope: MODE_SKETCHING_KEYMAP_SCOPE,
      selectable: false,
    }),
    provideMode({
      id: 'sketchSolve',
      label: 'Sketch',
      icon: 'sketch',
      toolbar: 'sketchSolve',
      Scene: BuiltInModeScene,
      keymapScope: MODE_SKETCH_SOLVE_KEYMAP_SCOPE,
      selectable: false,
    }),
  ],
})
