import type { Models } from '@kittycad/lib/dist/types/src'
import { VITE_KITTYCAD_API_URL } from '@src/env'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'

export async function sendTelemetry(
  id: string,
  feedback: Models['MlFeedback_type'],
  token?: string
): Promise<void> {
  const url =
    VITE_KITTYCAD_API_URL + '/user/text-to-cad/' + id + '?feedback=' + feedback
  await crossPlatformFetch(
    url,
    {
      method: 'POST',
    },
    token
  )
}
