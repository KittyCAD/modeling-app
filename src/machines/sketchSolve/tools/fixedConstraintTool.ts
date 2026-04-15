import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'fixedConstraintTool',
  toolId: 'Fixed constraint tool',
})
