import { useApp } from '@src/lib/boot'
import { LayoutRootNode } from '@src/lib/layout/components'
import { testLayoutConfig } from '@src/lib/layout/configs/test'
import { testAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import type { Layout, LayoutWithMetadata } from '@src/lib/layout/types'
import { useEffect, useState } from 'react'

function getTestLayout(settingsLayout: LayoutWithMetadata | undefined): Layout {
  return structuredClone(settingsLayout?.layout ?? testLayoutConfig)
}

export function TestLayout() {
  const { settings } = useApp()
  const settingsLayout = settings.useSettings().layout.configs.current.test
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
      notifications={[]}
      artifactGraph={new Map()}
    />
  )
}
