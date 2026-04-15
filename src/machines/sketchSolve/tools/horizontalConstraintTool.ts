import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'horizontalConstraintTool',
  toolId: 'Horizontal constraint tool',
})
