import { useApp } from '@src/lib/boot'
import { buildToolbarConfig } from '@src/lib/toolbar'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { useMemo } from 'react'

export const useToolbarConfig = () => {
  const { commands, userFeatures } = useApp()
  const showExperimentalFeatures = userFeatures.useHas(
    EXPERIMENTAL_POINT_AND_CLICK_FLAG,
    false
  )

  return useMemo(
    () =>
      buildToolbarConfig(commands, {
        showExperimentalFeatures,
      }),
    [commands, showExperimentalFeatures]
  )
}
