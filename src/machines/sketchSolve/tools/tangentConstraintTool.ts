import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'tangentConstraintTool',
  toolId: 'Tangent constraint tool',
})
