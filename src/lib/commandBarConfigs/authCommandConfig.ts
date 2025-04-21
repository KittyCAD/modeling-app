import type { Command } from '@src/lib/commandTypes'
import { authActor } from '@src/machines/appMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import { refreshPage } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'

export const authCommands: Command[] = [
  {
    groupId: ACTOR_IDS.AUTH,
    name: 'log-out',
    displayName: 'Log out',
    icon: 'arrowLeft',
    needsReview: false,
    onSubmit: () => authActor.send({ type: 'Log out' }),
  },
  {
    groupId: ACTOR_IDS.AUTH,
    name: 'refresh',
    displayName: 'Refresh app',
    icon: 'arrowRotateRight',
    needsReview: false,
    onSubmit: () => {
      refreshPage('Command palette').catch(reportRejection)
    },
  },
]
