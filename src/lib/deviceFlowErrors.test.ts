import { getDeviceFlowError } from '@src/lib/deviceFlowErrors'
import { describe, expect, it } from 'vitest'

describe('getDeviceFlowError', () => {
  it('preserves a certificate cause in the message sent over IPC', () => {
    const cause = Object.assign(
      new Error('unable to get local issuer certificate'),
      { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }
    )
    const original = new TypeError('fetch failed', { cause })

    // ipcRenderer.invoke receives only the main-process error's message.
    const received = new Error(getDeviceFlowError(original).message)

    expect(received.message).toContain('fetch failed')
    expect(received.message).toContain('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')
    expect(received.message).toContain('unable to get local issuer certificate')
  })

  it('includes individual connection failures from an aggregate cause', () => {
    const cause = new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED ::1:443'), {
        code: 'ECONNREFUSED',
      }),
      Object.assign(new Error('connect ETIMEDOUT 127.0.0.1:443'), {
        code: 'ETIMEDOUT',
      }),
    ])

    const result = getDeviceFlowError(new TypeError('fetch failed', { cause }))

    expect(result.message).toContain('ECONNREFUSED')
    expect(result.message).toContain('ETIMEDOUT')
  })
})
