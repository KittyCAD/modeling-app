import type { Command } from '@src/lib/commandTypes'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'
import type { authMachine } from '@src/machines/authMachine'
import { GLOBAL_KEYMAP_SCOPES } from '@src/registry/contracts/keymap'
import type { ActorRefFrom } from 'xstate'

export function createAuthCommands({
  authActor,
}: {
  authActor: ActorRefFrom<typeof authMachine>
}) {
  const authCommands: Command[] = [
    {
      scopes: GLOBAL_KEYMAP_SCOPES,
      groupId: 'auth',
      name: 'log-out',
      displayName: 'Log out',
      description: 'Log out of your account.',
      icon: 'arrowShortLeft',
      needsReview: false,
      onSubmit: () => authActor.send({ type: 'Log out' }),
    },
    {
      scopes: GLOBAL_KEYMAP_SCOPES,
      groupId: 'auth',
      name: 'refresh',
      displayName: 'Reload app',
      description: 'Force the scene, features, and editor to reload.',
      icon: 'arrowRotateFullRight',
      needsReview: false,
      onSubmit: () => {
        refreshPage('Command palette').catch(reportRejection)
      },
    },
  ]
  return authCommands
}
