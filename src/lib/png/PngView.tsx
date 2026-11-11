import { useSignals } from '@preact/signals-react/runtime'
import { useEffect, useState } from 'react'
import type { Editor } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import { ImageCanvas } from '@src/lib/imageCanvas/ImageCanvas'

/** The surface owns its binary read and object URL; decoded editor text is never image data. */
export function PngView({
  editor,
  readFile,
}: {
  editor: Editor
  readFile: (src: string) => Promise<Uint8Array>
}) {
  useSignals()
  const src = editor.src.value
  const [result, setResult] = useState<{ src: string; value: Blob | Error }>()
  useEffect(() => {
    if (!src) return
    const lifetime = new AbortController()
    void readFile(src)
      .then((bytes) => {
        if (!lifetime.signal.aborted)
          setResult({
            src,
            value: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
          })
      })
      .catch((cause) => {
        if (!lifetime.signal.aborted)
          setResult({
            src,
            value: isErr(cause) ? cause : new Error(String(cause)),
          })
      })
    return () => lifetime.abort()
  }, [src, readFile])
  if (!src)
    return (
      <p role="status" className="p-4">
        Assign a PNG file path to this buffer to view its image.
      </p>
    )
  if (!result || result.src !== src)
    return (
      <p role="status" className="p-4">
        Loading image...
      </p>
    )
  if (isErr(result.value))
    return (
      <p role="alert" className="p-4">
        {result.value.message}
      </p>
    )
  return <ImageCanvas blob={result.value} name={fsZds.basename(src)} />
}
