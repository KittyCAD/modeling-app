import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'verticalConstraintTool',
  toolId: 'Vertical constraint tool',
})
