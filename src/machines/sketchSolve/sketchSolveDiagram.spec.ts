import { shouldPreserveSelectionForTool } from '@src/machines/sketchSolve/sketchSolveDiagram'
import { describe, expect, test } from 'vitest'

describe('shouldPreserveSelectionForTool', () => {
  test('preserves preselection when equipping Fillet', () => {
    expect(shouldPreserveSelectionForTool('filletTool')).toBe(true)
  })

  test('does not preserve preselection for ordinary creation tools', () => {
    expect(shouldPreserveSelectionForTool('lineTool')).toBe(false)
    expect(shouldPreserveSelectionForTool('circleTool')).toBe(false)
  })
})
