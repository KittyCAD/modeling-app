import type { MlFeedback } from '@kittycad/lib'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

export async function sendTelemetry(
  id: string,
  feedback: MlFeedback,
  token?: string
): Promise<void> {
  const url = withAPIBaseURL(`/user/text-to-cad/${id}?feedback=${feedback}`)
  await crossPlatformFetch(
    url,
    {
      method: 'POST',
    },
    token
  )
}
