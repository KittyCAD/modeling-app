import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'parallelConstraintTool',
  toolId: 'Parallel constraint tool',
})
