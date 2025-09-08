import type { MlFeedback } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'
// migrated to SDK

export async function sendTelemetry(
  id: string,
  feedback: MlFeedback,
  token?: string
): Promise<void | Error> {
  const client = createKCClient(token)
  const res = await kcCall(() =>
    ml.create_text_to_cad_model_feedback({ client, id, feedback })
  )
  if (res instanceof Error) return res
}
