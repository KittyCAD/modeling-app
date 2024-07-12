import { StateMachineCommandSetConfig } from 'lib/commandTypes'
import { authMachine } from 'machines/authMachine'

type AuthCommandSchema = {}

export const authCommandBarConfig: StateMachineCommandSetConfig<
  typeof authMachine,
  AuthCommandSchema
> = {
  'Log in': {
    hide: 'both',
  },
  'Log out': {
    args: [],
    icon: 'arrowLeft',
  },
}
