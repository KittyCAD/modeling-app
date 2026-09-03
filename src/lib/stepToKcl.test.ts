import {
  StepToKclDraftBroker,
  buildStepToKclPrompt,
  generatedKclFileName,
  isStepFileName,
} from '@src/lib/stepToKcl'
import { describe, expect, test, vi } from 'vitest'

describe('STEP-to-KCL draft', () => {
  test('recognizes both STEP extensions without case sensitivity', () => {
    expect(isStepFileName('part.step')).toBe(true)
    expect(isStepFileName('PART.STP')).toBe(true)
    expect(isStepFileName('part.stl')).toBe(false)
  })

  test('builds a non-destructive editable reconstruction prompt', () => {
    expect(generatedKclFileName('mounting-bracket.step')).toBe(
      'mounting-bracket.generated.kcl'
    )

    const prompt = buildStepToKclPrompt('mounting-bracket.step')
    expect(prompt).toContain('standalone, editable KCL')
    expect(prompt).toContain('mounting-bracket.generated.kcl')
    expect(prompt).toContain(
      'Activate the step-to-kcl skill before inspecting the source.'
    )
    expect(prompt).toContain('Do not modify or delete existing project files')
    expect(prompt).toContain('do not import or reference the STEP file')
  })

  test('holds a draft until the Zookeeper pane subscribes', () => {
    const broker = new StepToKclDraftBroker()
    const listener = vi.fn()
    const attachment = new File(['ISO-10303-21;'], 'part.step')

    broker.request(attachment)
    const unsubscribe = broker.subscribe(listener)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ attachment, prompt: expect.any(String) })
    )

    unsubscribe()
  })
})
