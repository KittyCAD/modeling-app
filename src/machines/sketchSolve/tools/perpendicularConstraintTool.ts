import { createConstraintToolMachine } from '@src/machines/sketchSolve/tools/constraintToolMachine'

export const machine = createConstraintToolMachine({
  toolName: 'perpendicularConstraintTool',
  toolId: 'Perpendicular constraint tool',
})
