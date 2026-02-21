import type { Bonjour, Browser, Service } from 'bonjour-service'

export interface DiscoverMachineApiOptions {
  timeoutAfterMs?: number
  createBonjour: (onError: (error: Error) => void) => Bonjour
  onError?: (error: unknown) => void
}

export const DEFAULT_MACHINE_API_DISCOVERY_TIMEOUT_MS = 5_000

export const discoverMachineApi = async ({
  timeoutAfterMs = DEFAULT_MACHINE_API_DISCOVERY_TIMEOUT_MS,
  createBonjour,
  onError,
}: DiscoverMachineApiOptions): Promise<string | null> => {
  return new Promise((resolve) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let browser: Browser | undefined
    let bonjour: Bonjour | undefined

    const cleanupAndResolve = (value: string | null) => {
      if (settled) {
        return
      }
      settled = true

      if (timeout) {
        clearTimeout(timeout)
      }

      if (browser) {
        try {
          browser.stop()
        } catch (error) {
          onError?.(error)
        }
      }

      if (bonjour) {
        try {
          bonjour.destroy()
        } catch (error) {
          onError?.(error)
        }
      }

      resolve(value)
    }

    bonjour = createBonjour((error: Error) => {
      onError?.(error)
      cleanupAndResolve(null)
    })

    timeout = setTimeout(() => {
      cleanupAndResolve(null)
    }, timeoutAfterMs)

    browser = bonjour.find(
      { protocol: 'tcp', type: 'machine-api' },
      (service: Service) => {
        const ip = service.addresses?.[0]
        if (!ip) {
          cleanupAndResolve(null)
          return
        }
        cleanupAndResolve(`${ip}:${service.port}`)
      }
    )
  })
}
