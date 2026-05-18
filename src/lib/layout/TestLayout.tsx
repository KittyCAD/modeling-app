import { useEffect, useState } from 'react'
import { testLayoutConfig } from '@src/lib/layout/configs/test'
import { LayoutRootNode } from '@src/lib/layout/components'
import { testAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import type { Layout, LayoutWithMetadata } from '@src/lib/layout/types'
import { useApp } from '@src/lib/boot'

function getTestLayout(settingsLayout: LayoutWithMetadata | undefined): Layout {
  return structuredClone(settingsLayout?.layout ?? testLayoutConfig)
}

export function TestLayout() {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const settingsLayout = settingsValues.layout.configs.current.test
  const [layout, setLayout] = useState(() =>
    getTestLayout(settings.get().layout.configs.current.test)
  )

  useEffect(() => {
    if (settingsLayout) {
      setLayout(getTestLayout(settingsLayout))
    }
  }, [settingsLayout])

  return (
    <LayoutRootNode
      layout={layout}
      getLayout={() => layout}
      setLayout={setLayout}
      layoutName="test"
      areaLibrary={testAreaLibrary}
      enableContextMenus={true}
      showDebugPanel={false}
      settings={settingsValues}
      notifications={[]}
      artifactGraph={new Map()}
    />
  )
}
