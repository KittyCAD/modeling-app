import type { Command } from '@src/lib/commandTypes'
import { ACTOR_IDS } from '@src/machines/machineConstants'
import { refreshPage } from '@src/lib/utils'
import { reportRejection } from '@src/lib/trap'
import type { ActorRefFrom } from 'xstate'
import type { authMachine } from '@src/machines/authMachine'

export function createAuthCommands({
  authActor,
}: { authActor: ActorRefFrom<typeof authMachine> }) {
  const authCommands: Command[] = [
    {
      groupId: ACTOR_IDS.AUTH,
      name: 'log-out',
      displayName: 'Log out',
      description: 'Log out of your account.',
      icon: 'arrowLeft',
      needsReview: false,
      onSubmit: () => authActor.send({ type: 'Log out' }),
    },
    {
      groupId: ACTOR_IDS.AUTH,
      name: 'refresh',
      displayName: 'Refresh app',
      description: 'Force the scene, features, and editor to reload.',
      icon: 'exclamationMark',
      needsReview: false,
      onSubmit: () => {
        refreshPage('Command palette').catch(reportRejection)
      },
    },
  ]
  return authCommands
}
