import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'equalLengthConstraintTool',
  toolId: 'Equal length constraint tool',
})
