import { X509Certificate } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { on: vi.fn() } }))
import { matchesInstalledDriverCertificate } from './electron'

// Self-signed test certificate for 127.51.68.120; never used by the plugin.
const pem = `-----BEGIN CERTIFICATE-----
MIIDJDCCAgygAwIBAgIUadZLU/sDXh2LzXyiiaKjDF24Gs0wDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOU3BhY2VNb3VzZVRlc3QwHhcNMjYxMTAyMTQxNTAwWhcN
MzYxMDMwMTQxNTAwWjAZMRcwFQYDVQQDDA5TcGFjZU1vdXNlVGVzdDCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBANh5slLOJH+TNLzt3dsVzjKrprz19NHK
9kRyQdduENjavr8eaVFqHcwGn74CucP101k3JKRwNH/X/C/VXMiXjX6iEnJ63rb4
xjWNdrA7Y5d+ruB/hOCXGq7+EskeIE1LY8x7Uj6aIpuwew8kqL74f64enemAEgRG
ZjhSQWK1Ol293fvIBPq/j5ipDksF7j7IcysPXZLrHq+c+vlRZPNdaUWkDHxcehUy
W6l+gvL9QQ/O/t5dTMY4F3yjbXe1K04KOP5nMMMdIzhlJ26MmssejY0IzQkBye1c
gZPb3dI3OOcuvp0NZ8O+meo3pkXTezant/vK6Osupzc0K2uw8s+ypW0CAwEAAaNk
MGIwHQYDVR0OBBYEFCkPpG+4Mv/PbYyfs7iMnYE/VQTVMB8GA1UdIwQYMBaAFCkP
pG+4Mv/PbYyfs7iMnYE/VQTVMA8GA1UdEwEB/wQFMAMBAf8wDwYDVR0RBAgwBocE
fzNEeDANBgkqhkiG9w0BAQsFAAOCAQEAoFNCA+M+KsdCeAsSdUdaIVm6VYQDEJfB
KUJ+wlsiFF6+yRI8QPWdJ94rL05NEr2q2Zj/T9X8zfpjVczfuLNE9VOKZ70leK4x
QjeZIIkIQwF/NKbdqIMrIrZjNPzqYX/rHO7JhBaEob3sl7790mQSFbp20QxJn9l2
vGjKBJK64x9A+JMwnNBV6qwH/vLtxRjVeaprgzOzh5lZAx/tQLz5IqhTiBsiQIzK
F8OggpPH4Yl/s+kLlbpLnZRnoDk5ZjB52LQVYZQcoZ5Fk6T5IjL8lqAK9u54VJ3s
LyNlEu3Bgw5MSjNJ1GrhEZuzgwspvknabXhsVrWqiRLJx3FfNhBykQ==
-----END CERTIFICATE-----`

const certificate = new X509Certificate(pem)
const duringValidity = Date.parse(certificate.validFrom) + 1000
const endpoint = 'https://127.51.68.120:8181/3dconnexion/nlproxy'

describe('SpaceMouse certificate pinning', () => {
  it('accepts the exact installed certificate at the driver endpoint', () => {
    expect(
      matchesInstalledDriverCertificate(endpoint, pem, pem, duringValidity)
    ).toBe(true)
    expect(
      matchesInstalledDriverCertificate(
        'wss://127.51.68.120:1234',
        pem,
        pem,
        duringValidity
      )
    ).toBe(true)
  })

  it('rejects a different certificate even on the correct host', () => {
    const different = Buffer.from(certificate.raw)
    different[different.length - 1] ^= 1
    expect(
      matchesInstalledDriverCertificate(
        endpoint,
        pem,
        new X509Certificate(different).toString(),
        duringValidity
      )
    ).toBe(false)
  })

  it('rejects other origins, expired certificates, and invalid certificate files', () => {
    expect(
      matchesInstalledDriverCertificate(
        'https://example.com',
        pem,
        pem,
        duringValidity
      )
    ).toBe(false)
    expect(
      matchesInstalledDriverCertificate(
        'http://127.51.68.120',
        pem,
        pem,
        duringValidity
      )
    ).toBe(false)
    expect(
      matchesInstalledDriverCertificate(
        endpoint,
        pem,
        pem,
        Date.parse(certificate.validTo) + 1
      )
    ).toBe(false)
    expect(
      matchesInstalledDriverCertificate(
        endpoint,
        pem,
        'invalid',
        duringValidity
      )
    ).toBe(false)
  })
})
