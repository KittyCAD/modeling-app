import type { Command } from '@src/lib/commandTypes'
import { authActor } from '@src/machines/appMachine'
import { ACTOR_IDS } from '@src/machines/machineConstants'

export const authCommands: Command[] = [
  {
    groupId: ACTOR_IDS.AUTH,
    name: 'log-out',
    displayName: 'Log out',
    icon: 'arrowLeft',
    needsReview: false,
    onSubmit: () => authActor.send({ type: 'Log out' }),
  },
]
