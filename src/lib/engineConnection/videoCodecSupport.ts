// Keep this list aligned with the video tracks Engine can produce. Once that
// contract is available before Engine allocation, replace this constant with
// API-provided metadata. See modeling-app#13673.
export const ENGINE_SUPPORTED_VIDEO_CODECS = ['video/H264'] as const

const normalizeCodec = (mimeType: string) => mimeType.trim().toLowerCase()

export type EngineVideoCodecSupport = {
  status: 'unknown' | 'supported' | 'unsupported'
  browserCodecs: readonly string[]
  engineCodecs: typeof ENGINE_SUPPORTED_VIDEO_CODECS
}

export class UnsupportedEngineVideoCodecError extends Error {
  readonly browserCodecs: readonly string[]
  readonly engineCodecs = ENGINE_SUPPORTED_VIDEO_CODECS

  constructor(browserCodecs: readonly string[]) {
    super(
      'This browser cannot receive H.264 video, which Zoo Design Studio currently requires. Enable OpenH264 and reload, or use another supported browser.'
    )
    this.name = 'UnsupportedEngineVideoCodecError'
    this.browserCodecs = browserCodecs
  }
}

export const getVideoCodecsFromSdp = (sdp: string) => {
  const codecs = new Set<string>()
  let isVideoSection = false

  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      isVideoSection = line.startsWith('m=video ')
      continue
    }
    if (!isVideoSection) {
      continue
    }

    const match = /^a=rtpmap:\d+\s+([^/\s]+)\//i.exec(line)
    if (match?.[1]) {
      codecs.add(normalizeCodec(`video/${match[1]}`))
    }
  }

  return Array.from(codecs)
}

export const getEngineVideoCodecSupport = (
  browserCodecs: readonly string[] | undefined
): EngineVideoCodecSupport => {
  if (!browserCodecs) {
    return {
      status: 'unknown',
      browserCodecs: [],
      engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
    }
  }

  const normalizedBrowserCodecs = Array.from(
    new Set(browserCodecs.map(normalizeCodec))
  )
  const engineCodecs = new Set(
    ENGINE_SUPPORTED_VIDEO_CODECS.map(normalizeCodec)
  )
  const status = normalizedBrowserCodecs.some((codec) =>
    engineCodecs.has(codec)
  )
    ? 'supported'
    : 'unsupported'

  return {
    status,
    browserCodecs: normalizedBrowserCodecs,
    engineCodecs: ENGINE_SUPPORTED_VIDEO_CODECS,
  }
}

const getBrowserOfferedVideoCodecs = async () => {
  if (typeof RTCPeerConnection === 'undefined') {
    return undefined
  }

  const peerConnection = new RTCPeerConnection()
  try {
    peerConnection.addTransceiver('video', { direction: 'recvonly' })
    const offer = await peerConnection.createOffer()
    return offer?.sdp ? getVideoCodecsFromSdp(offer.sdp) : undefined
  } catch {
    // Preserve the existing negotiation path when a browser cannot provide a
    // local preflight offer. The real connection will report the full error.
    return undefined
  } finally {
    peerConnection.close()
  }
}

export const preflightEngineVideoCodecSupport = async (): Promise<
  EngineVideoCodecSupport | UnsupportedEngineVideoCodecError
> => {
  const support = getEngineVideoCodecSupport(
    await getBrowserOfferedVideoCodecs()
  )
  if (support.status === 'unsupported') {
    return new UnsupportedEngineVideoCodecError(support.browserCodecs)
  }
  return support
}

export const isUnsupportedEngineVideoCodecError = (
  error: unknown
): error is UnsupportedEngineVideoCodecError =>
  error instanceof UnsupportedEngineVideoCodecError
