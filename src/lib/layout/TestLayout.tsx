import { useState } from 'react'
import { testLayoutConfig } from '@src/lib/layout/configs/test'
import { loadLayout } from '@src/lib/layout/utils'
import { LayoutRootNode } from '@src/lib/layout/components'
import { testAreaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { isErr } from '@src/lib/trap'

// Attempt to load a persisted layout
const testLayoutResult = loadLayout('test')
const testLayout = isErr(testLayoutResult) ? testLayoutConfig : testLayoutResult

export function TestLayout() {
  const [layout, setLayout] = useState(testLayout)

  return (
    <LayoutRootNode
      layout={layout}
      setLayout={setLayout}
      layoutName="test"
      areaLibrary={testAreaTypeRegistry}
    />
  )
}
