import type { TextToCad } from '@kittycad/lib'
import { ml } from '@kittycad/lib'
import { createKCClient, kcCall } from '@src/lib/kcClient'

export async function textToCadPromptFeedback(
  token: string,
  args: {
    id: TextToCad['id']
    feedback: TextToCad['feedback']
  }
): Promise<undefined | Error> {
  if (!args.feedback) return
  const client = createKCClient(token)
  const fb = args.feedback
  const data = await kcCall(() =>
    ml
      .create_text_to_cad_part_feedback({
        client,
        id: args.id,
        feedback: fb,
      })
      .then(() => undefined)
  )

  return data
}
