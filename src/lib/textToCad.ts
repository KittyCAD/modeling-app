import { Models } from '@kittycad/lib'
import { VITE_KC_API_BASE_URL } from 'env'

export async function submitTextToCadPrompt(
  prompt: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = { prompt }
  const response = await fetch(
    VITE_KC_API_BASE_URL + '/ai/text-to-cad/gltf?kcl=true',
    {
      method: 'POST',
      body: JSON.stringify(body),
      credentials: 'include',
    }
  )

  if (!response.ok) {
    return new Error('Failed to request text-to-cad endpoint')
  }

  const data = (await response.json()) as Models['TextToCad_type'] | Error
  return data
}
