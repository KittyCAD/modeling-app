import { useState } from 'react'
import { initialTestLayout } from '@src/lib/layout/testLayoutConfig'
import { loadLayout } from '@src/lib/layout/utils'
import { LayoutRoot } from '@src/lib/layout/Layout'
import { testAreaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'
import { isErr } from '@src/lib/trap'

// Attempt to load a persisted layout
const testLayoutResult = loadLayout('test')
const testLayout = isErr(testLayoutResult)
  ? initialTestLayout
  : testLayoutResult

export function TestLayout() {
  const [layout, setLayout] = useState(testLayout)

  return (
    <LayoutRoot
      layout={layout}
      setLayout={setLayout}
      layoutName="test"
      areaLibrary={testAreaTypeRegistry}
    />
  )
}
