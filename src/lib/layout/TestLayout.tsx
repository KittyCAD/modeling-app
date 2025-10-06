import { useState } from 'react'
import { testLayout } from '@src/lib/layout/testLayoutConfig'
import { loadLayout } from '@src/lib/layout/utils'
import { LayoutRoot } from '@src/lib/layout/Layout'
import { testAreaTypeRegistry } from '@src/lib/layout/areaTypeRegistry'

export function TestLayout() {
  const [layout, setLayout] = useState(loadLayout('test') || testLayout)

  return (
    <LayoutRoot
      layout={layout}
      setLayout={setLayout}
      areaLibrary={testAreaTypeRegistry}
    />
  )
}
