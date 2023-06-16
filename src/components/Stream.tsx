import { useEffect, useRef } from 'react'
import { PanelHeader } from '../components/PanelHeader'
import { v4 as uuidv4 } from 'uuid'

export const Stream = () => {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined'
    )
      return
    const url =
      'ws://jess-testing.hawk-dinosaur.ts.net:8080/ws/modeling/commands'
    const [pc, socket] = [new RTCPeerConnection(), new WebSocket(url)]
    const file_id = uuidv4()
    let currentCmdId: null | string = null

    // Connection opened
    socket.addEventListener('open', (event) => {
      console.log('Connected to websocket, waiting for ICE servers')
    })

    socket.addEventListener('close', (event) => {
      console.log('websocket connection closed')
    })

    socket.addEventListener('error', (event) => {
      console.log('websocket connection error')
    })

    // Listen for messages
    socket.addEventListener('message', (event) => {
      //console.log('Message from server ', event.data);
      if (event.data instanceof Blob) {
        const reader = new FileReader()

        reader.onload = () => {
          //console.log("Result: " + reader.result);
        }

        reader.readAsText(event.data)
      } else {
        console.log(event.data)
        const message = JSON.parse(event.data)
        if (message.type === 'SDPAnswer') {
          pc.setRemoteDescription(new RTCSessionDescription(message.answer))
        } else if (message.type === 'IceServerInfo') {
          console.log('received IceServerInfo')
          pc.setConfiguration({
            iceServers: message.ice_servers,
          })
          pc.ontrack = function (event) {
            if (
              videoRef.current &&
              event &&
              event.track &&
              event.track.kind == 'video'
            ) {
              videoRef.current.srcObject = event.streams[0]
              videoRef.current.autoplay = true
              videoRef.current.muted = true
              videoRef.current.controls = false

              // Wait for a second then draw a curve.
              setTimeout(drawCurve, 1000)
            }
          }
          pc.oniceconnectionstatechange = (e) =>
            console.log(pc.iceConnectionState)
          pc.onicecandidate = (event) => {
            if (event.candidate === null) {
              console.log('sent SDPOffer')
              socket.send(
                JSON.stringify({
                  type: 'SDPOffer',
                  offer: pc.localDescription,
                })
              )
            }
          }

          // Offer to receive 1 video track
          pc.addTransceiver('video', {
            direction: 'sendrecv',
          })
          pc.createOffer()
            .then((d) => pc.setLocalDescription(d))
            .catch(console.log)
        }
      }
    })

    const debounceSocketSend = throttle((message) => {
      console.log(JSON.stringify(message))
      socket.send(JSON.stringify(message))
    }, 100)

    const handleClick = ({ clientX, clientY }: MouseEvent) => {
      if (!videoRef.current) return
      const { left, top } = videoRef.current.getBoundingClientRect()
      const x = clientX - left
      const y = clientY - top
      console.log('click', x, y)

      if (currentCmdId == null) {
        currentCmdId = uuidv4()

        debounceSocketSend({
          type: 'ModelingCmdReq',
          cmd: {
            CameraDragStart: {
              interaction: 'rotate',
              window: {
                x: x,
                y: y,
              },
            },
          },
          cmd_id: uuidv4(),
          file_id: file_id,
        })
      }
    }

    const handleMouseUp = ({ clientX, clientY }: MouseEvent) => {
      if (!videoRef.current) return
      const { left, top } = videoRef.current.getBoundingClientRect()
      const x = clientX - left
      const y = clientY - top
      console.log('click', x, y)

      if (currentCmdId == null) {
        return
      }

      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          CameraDragEnd: {
            interaction: 'rotate',
            window: {
              x: x,
              y: y,
            },
          },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
        currentCmdId   = null
    }

    const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
      if (!videoRef.current) return
      const { left, top } = videoRef.current.getBoundingClientRect()
      const x = clientX - left
      const y = clientY - top

      if (currentCmdId == null) {
        return
      } else {
      console.log('mouse move', x, y)
        debounceSocketSend({
          type: 'ModelingCmdReq',
          cmd: {
            CameraDragMove: {
              interaction: 'rotate',
              window: {
                x: x,
                y: y,
              },
            },
          },
          cmd_id: uuidv4(),
          file_id: file_id,
        })
      }
    }

    const drawLine = () => {
      let cmdId = uuidv4()
      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          StartPath: {},
        },
        cmd_id: cmdId,
        file_id: file_id,
      })
      // Let's move the path pen.
      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          MovePathPen: {
            path: cmdId,
            to: {
              x: 0,
              y: 0,
              z: 0,
            },
          },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
      // End the line.
      // Let's extend the line from where the path pen was.
      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          ExtendPath: {
            path: currentCmdId,
            segment: {
              Line: {
                end: {
                  x: 10,
                  y: 10,
                  z: 0,
                },
              },
            },
          },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
    }

    const drawCurve = () => {
      let cmdId = uuidv4()
      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          StartPath: {},
        },
        cmd_id: cmdId,
        file_id: file_id,
      })
      debounceSocketSend({
        type: 'ModelingCmdReq',
        cmd: {
          ExtendPath: {
            path: cmdId,
            segment: {
              Arc: {
                center: {
                  x: 0,
                  y: 0,
                  z: 0,
                },
                radius: 2.0,
                angle_start: 10.0,
                angle_end: 3.14,
              },
            },
          },
        },
        cmd_id: uuidv4(),
        file_id: file_id,
      })
    }

    if (videoRef.current) {
      videoRef.current.addEventListener('mousemove', handleMouseMove)
      videoRef.current.addEventListener('mousedown', handleClick)
      videoRef.current.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      socket.close()
      pc.close()
      if (!videoRef.current) return
      videoRef.current.removeEventListener('mousemove', handleMouseMove)
      videoRef.current.removeEventListener('mousedown', handleClick)
      videoRef.current.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div>
      <PanelHeader title="Stream" />
      <video ref={videoRef} />
    </div>
  )
}

function throttle(
  func: (...args: any[]) => any,
  wait: number
): (...args: any[]) => any {
  let timeout: ReturnType<typeof setTimeout> | null
  let latestArgs: any[]
  let latestTimestamp: number

  function later() {
    timeout = null
    func(...latestArgs)
  }

  function throttled(...args: any[]) {
    const currentTimestamp = Date.now()
    latestArgs = args

    if (!latestTimestamp || currentTimestamp - latestTimestamp >= wait) {
      latestTimestamp = currentTimestamp
      func(...latestArgs)
    } else if (!timeout) {
      timeout = setTimeout(later, wait - (currentTimestamp - latestTimestamp))
    }
  }

  return throttled
}
