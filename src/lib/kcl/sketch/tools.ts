import { computed } from '@preact/signals-core'
import type { SketchToolDefinition } from '@src/lib/kcl/sketch/contract'
export const circleSketchTool: SketchToolDefinition = {
  id: 'sketch.circle',
  name: 'Circle',
  groupId: 'kcl.sketch.draw',
  icon: 'circle',
  create: async (host) => {
    const { createCircleInteraction } = await import(
      '@src/lib/kcl/sketch/circle'
    )
    const circle = createCircleInteraction(host)
    return {
      prompt: computed(() =>
        circle.phase.value === 'radius'
          ? 'Pick circle radius'
          : ['creating', 'committing', 'closing'].includes(circle.phase.value)
            ? 'Updating circle'
            : 'Pick circle center'
      ),
      escape: async () => false,
      dispose: circle.dispose,
    }
  },
}
