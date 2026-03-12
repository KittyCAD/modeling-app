import type { User } from '@kittycad/lib'
import { withSiteBaseURL } from '@src/lib/withBaseURL'

type UserBlockReason = NonNullable<User['block']>

const ACCOUNT_URL = withSiteBaseURL('/account')
const UNKNOWN_BLOCK_REASON_TEXT =
  'Your account is temporarily on hold. Please contact support.'

const USER_BLOCK_REASON_TEXT: Record<UserBlockReason, string> = {
  missing_payment_method: `You need a payment method to keep using Zookeeper. Go to your [account](${ACCOUNT_URL}) to fix this.`,
  payment_method_failed: `Your payment method failed. Go to your [account](${ACCOUNT_URL}) to fix this.`,
}

export function getUserBlockedReason(
  user?: Pick<User, 'block'> | null
): string | undefined {
  if (!user?.block) {
    return undefined
  }

  return USER_BLOCK_REASON_TEXT[user.block] ?? UNKNOWN_BLOCK_REASON_TEXT
}
