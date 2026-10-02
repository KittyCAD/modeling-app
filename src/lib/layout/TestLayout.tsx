import { useApp } from '@src/lib/boot'
import { LayoutRootNode } from '@src/lib/layout/components'
import { testLayoutConfig } from '@src/lib/layout/configs/test'
import { testAreaLibrary } from '@src/lib/layout/defaultAreaLibrary'
import type { Layout, LayoutWithMetadata } from '@src/lib/layout/types'
import { applyPaneOpenBehavior } from '@src/lib/layout/utils'
import { useEffect, useState } from 'react'

function getTestLayout(settingsLayout: LayoutWithMetadata | undefined): Layout {
  return structuredClone(settingsLayout?.layout ?? testLayoutConfig)
}

export function TestLayout() {
  const { settings } = useApp()
  const layoutSettings = settings.useSettings().layout
  const settingsLayout = layoutSettings.configs.current.test
  const paneOpenBehavior = layoutSettings.paneOpenBehavior.current
  const [layout, setLayout] = useState(() =>
    applyPaneOpenBehavior(
      getTestLayout(settings.get().layout.configs.current.test),
      paneOpenBehavior
    )
  )

  useEffect(() => {
    if (settingsLayout) {
      setLayout(getTestLayout(settingsLayout))
    }
  }, [settingsLayout])

  useEffect(() => {
    setLayout((current) => applyPaneOpenBehavior(current, paneOpenBehavior))
  }, [paneOpenBehavior, settingsLayout])

  return (
    <LayoutRootNode
      layout={layout}
      paneOpenBehavior={paneOpenBehavior}
      getLayout={() => layout}
      setLayout={(next) =>
        setLayout((current) =>
          applyPaneOpenBehavior(
            next,
            settings.get().layout.paneOpenBehavior.current,
            current
          )
        )
      }
      layoutName="test"
      areaLibrary={testAreaLibrary}
      enableContextMenus={true}
      showDebugPanel={false}
      notifications={[]}
      artifactGraph={new Map()}
    />
  )
}
