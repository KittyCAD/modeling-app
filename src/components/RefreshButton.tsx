import React, { useMemo } from 'react'
import toast from 'react-hot-toast'

import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useMenuListener } from '@src/hooks/useMenu'
import { coreDump } from '@src/lang/wasm'
import { CoreDumpManager } from '@src/lib/coredump'
import {
  codeManager,
  engineCommandManager,
  rustContext,
} from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { useToken } from '@src/machines/appMachine'
import type { WebContentSendPayload } from '@src/menu/channels'

export const RefreshButton = ({ children }: React.PropsWithChildren) => {
  const token = useToken()
  const coreDumpManager = useMemo(
    () =>
      new CoreDumpManager(
        engineCommandManager,
        codeManager,
        rustContext,
        token
      ),
    []
  )

  async function refresh() {
    if (window && 'plausible' in window) {
      const p = window.plausible as (
        event: string,
        options?: { props: Record<string, string> }
      ) => Promise<void>
      // Send a refresh event to Plausible so we can track how often users get stuck
      await p('Refresh', {
        props: {
          method: 'UI button',
          // TODO: add more coredump data here
        },
      })
    }

    toast
      .promise(
        coreDump(coreDumpManager, true),
        {
          loading: 'Starting core dump...',
          success: 'Core dump completed successfully',
          error: 'Error while exporting core dump',
        },
        {
          success: {
            // Note: this extended duration is especially important for Playwright e2e testing
            // default duration is 2000 - https://react-hot-toast.com/docs/toast#default-durations
            duration: 6000,
          },
        }
      )
      .then(() => {
        // Window may not be available in some environments
        window?.location.reload()
      })
      .catch(reportRejection)
  }

  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'Help.Refresh and report a bug') {
      refresh().catch(reportRejection)
    }
  }
  useMenuListener(cb)

  return (
    <button
      onClick={toSync(refresh, reportRejection)}
      className="p-1 m-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 rounded-full border border-solid border-chalkboard-20 dark:border-chalkboard-90"
    >
      <CustomIcon name="exclamationMark" className="w-5 h-5" />
      <Tooltip position="bottom-right">
        <span>Refresh and report</span>
        <br />
        <span className="text-xs">Send us data on how you got stuck</span>
      </Tooltip>
    </button>
  )
}
