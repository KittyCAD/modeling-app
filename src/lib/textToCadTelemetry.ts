import type { Models } from '@kittycad/lib/dist/types/src'
import { VITE_KC_API_BASE_URL } from '@src/env'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'

export async function sendTelemetry(
  id: string,
  feedback: Models['MlFeedback_type'],
  token?: string
): Promise<void> {
  const url =
    VITE_KC_API_BASE_URL + '/user/text-to-cad/' + id + '?feedback=' + feedback
  await crossPlatformFetch(
    url,
    {
      method: 'POST',
    },
    token
  )
}
