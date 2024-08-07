import { TextToCad_type } from '@kittycad/lib/dist/types/src/models'
import { gear } from './exampleKcl'

export async function submitTextToCadPrompt(
  prompt: string
): Promise<TextToCad_type | Error> {
  // TODO: Replace this with a real API call
  //   const response = await fetch('https://api.example.com/text-to-cad', {
  //   method: 'POST',
  //   body: JSON.stringify({ prompt }),
  // })
  const response: Response = await new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        json: async () => ({
          outputs: {
            kcl: gear,
          },
        }),
      } as Response)
    }, 4000)
  })

  if (!response.ok) {
    return new Error('Failed to convert text to CAD')
  }

  const data = (await response.json()) as TextToCad_type | Error
  return data
}
