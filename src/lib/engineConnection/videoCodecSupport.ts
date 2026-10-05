import {
  type EngineConnectionError,
  EngineConnectionErrorKind,
} from '@src/lib/engineConnection/utils'

// Keep this aligned with the video tracks Engine can produce. Once this
// contract is available before Engine allocation, use API-provided metadata.
export const ENGINE_SUPPORTED_VIDEO_CODECS = ['video/h264'] as const

const UNSUPPORTED_ENGINE_VIDEO_CODEC_MESSAGE =
  'Browser does not offer the H.264 video codec required by Engine.'

const normalizeCodec = (mimeType: string) => mimeType.trim().toLowerCase()

export class UnsupportedEngineVideoCodecError
  extends Error
  implements EngineConnectionError
{
  readonly kind = EngineConnectionErrorKind.UnsupportedVideoCodec
  readonly terminal = true
  readonly browserCodecs: readonly string[]
  readonly engineCodecs = ENGINE_SUPPORTED_VIDEO_CODECS

  constructor(browserCodecs: readonly string[]) {
    super(UNSUPPORTED_ENGINE_VIDEO_CODEC_MESSAGE)
    this.name = 'UnsupportedEngineVideoCodecError'
    this.browserCodecs = browserCodecs
  }
}

const getVideoCodecsFromSdp = (sdp: string) => {
  const codecs = new Set<string>()
  let isVideoSection = false

  for (const line of sdp.split(/\r?\n/)) {
    if (line.startsWith('m=')) {
      isVideoSection = line.startsWith('m=video ')
      continue
    }
    if (!isVideoSection) continue

    const match = /^a=rtpmap:\d+\s+([^/\s]+)\//i.exec(line)
    if (match?.[1]) {
      codecs.add(normalizeCodec(`video/${match[1]}`))
    }
  }

  return Array.from(codecs)
}

const getBrowserOfferedVideoCodecs = async () => {
  if (typeof RTCPeerConnection === 'undefined') return undefined

  const peerConnection = new RTCPeerConnection()
  try {
    peerConnection.addTransceiver('video', { direction: 'recvonly' })
    const offer = await peerConnection.createOffer()
    return offer.sdp ? getVideoCodecsFromSdp(offer.sdp) : undefined
  } catch {
    // Preserve normal negotiation when local capability introspection fails.
    return undefined
  } finally {
    peerConnection.close()
  }
}

export const preflightEngineVideoCodecSupport = async (): Promise<
  UnsupportedEngineVideoCodecError | undefined
> => {
  const browserCodecs = await getBrowserOfferedVideoCodecs()
  if (browserCodecs === undefined) return undefined

  const supported = ENGINE_SUPPORTED_VIDEO_CODECS.some((codec) =>
    browserCodecs.includes(codec)
  )

  return supported
    ? undefined
    : new UnsupportedEngineVideoCodecError(browserCodecs)
}
