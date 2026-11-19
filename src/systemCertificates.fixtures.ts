// Synthetic public certificates generated locally with OpenSSL for these tests.
// The generated private key was discarded; only public certificate data is kept.

// Expires in 2126, well after the fixed 2030 test clock.
export const validSystemCertificate = `-----BEGIN CERTIFICATE-----
MIIBijCCAS+gAwIBAgIUcSkkP0uh82Ki0fJXdnwCasVClzEwCgYIKoZIzj0EAwIw
GTEXMBUGA1UEAwwOU3lzdGVtIENBIFRlc3QwIBcNMjYxMTEzMTgwMTE4WhgPMjEy
NjEwMjAxODAxMThaMBkxFzAVBgNVBAMMDlN5c3RlbSBDQSBUZXN0MFkwEwYHKoZI
zj0CAQYIKoZIzj0DAQcDQgAEq4VwKKdA3PcJqHFCSPOO/1CYrrx8e8rJVMVduR6O
3PLnSfSvysAuM+dMq+WI9H2/PqnmaruI7J/8G9oqova+76NTMFEwHQYDVR0OBBYE
FH0hDDTaU/PyQqneSfVgs+YDvke2MB8GA1UdIwQYMBaAFH0hDDTaU/PyQqneSfVg
s+YDvke2MA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSQAwRgIhANtYSoXZ
M0IWXV/boBZvkvCRxziY86T6feEpDXXRhZfUAiEAgIhfe1LISz0oRJANz7Mpk9UL
GUR0SDl0upXN9SJwlEo=
-----END CERTIFICATE-----`

// Expired in 2021, well before the fixed 2030 test clock.
export const expiredSystemCertificate = `-----BEGIN CERTIFICATE-----
MIIBQDCB6KADAgECAgECMAoGCCqGSM49BAMCMBkxFzAVBgNVBAMMDlN5c3RlbSBD
QSBUZXN0MB4XDTIwMDEwMTAwMDAwMFoXDTIxMDEwMTAwMDAwMFowGTEXMBUGA1UE
AwwOU3lzdGVtIENBIFRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASrhXAo
p0Dc9wmocUJI847/UJiuvHx7yslUxV25Ho7c8udJ9K/KwC4z50yr5Yj0fb8+qeZq
u4jsn/wb2iqi9r7voyEwHzAdBgNVHQ4EFgQUfSEMNNpT8/JCqd5J9WCz5gO+R7Yw
CgYIKoZIzj0EAwIDRwAwRAIgS3zIGhdVMel6cLli3xIdXoIvBBzo3hwTDGgwnSyT
gtUCIFIJI+2kTtIXyAUxbF9Id1YkVFENtIPU8Qe8rUpEfH7d
-----END CERTIFICATE-----`
