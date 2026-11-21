import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import type { Editor } from '@src/lib/editors/registry/contract'
import fsZds from '@src/lib/fs-zds'
import { useMemo } from 'react'

const previewLength = 64
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`
  const units = ['bytes', 'KiB', 'MiB', 'GiB', 'TiB']
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = (bytes / 1024 ** exponent).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  })
  return `${value} ${units[exponent]}`
}

/** File identity and a bounded byte preview remain useful without exposing binary data to text editing. */
export function BinaryFileView({
  editor,
}: {
  editor: Pick<Editor, 'src' | 'backing'>
}) {
  useSignals()
  const src = editor.src.value
  const backing = editor.backing
  const bytes = useMemo(
    () =>
      backing.type === 'binary'
        ? backing.readBytes(0, previewLength)
        : new Uint8Array(),
    [backing]
  )
  if (backing.type !== 'binary') return null
  const name = src ? fsZds.basename(src) : 'Unnamed file'
  const extension = src ? fsZds.extname(src) : ''
  const rows = []
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16)
    rows.push({
      offset: offset.toString(16).padStart(8, '0'),
      hex: Array.from(row, (byte) => byte.toString(16).padStart(2, '0')).join(
        ' '
      ),
      ascii: Array.from(row, (byte) =>
        byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'
      ).join(''),
    })
  }
  return (
    <section
      aria-label="File details"
      className="min-h-0 min-w-0 flex-1 overflow-auto bg-1 p-5 sm:p-8"
    >
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border b-4 bg-2 text-2"
          >
            <CustomIcon name="file" className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs text-2">File details</p>
            <h1 className="break-all text-lg font-semibold">{name}</h1>
          </div>
        </header>
        <dl className="mt-6 overflow-hidden rounded-lg border b-4 bg-2 text-sm">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 border-b b-4 px-4 py-3">
            <dt className="text-2">Size</dt>
            <dd className="tabular-nums">
              {formatSize(backing.byteLength)}
              {backing.byteLength >= 1024 && (
                <span className="ml-2 text-2">
                  ({backing.byteLength.toLocaleString()} bytes)
                </span>
              )}
            </dd>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 border-b b-4 px-4 py-3">
            <dt className="text-2">Extension</dt>
            <dd className="font-mono">{extension || 'None'}</dd>
          </div>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4 px-4 py-3">
            <dt className="text-2">Path</dt>
            <dd className="break-all font-mono text-xs leading-5">
              {src || 'Not saved'}
            </dd>
          </div>
        </dl>
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-medium">Header preview</h2>
            <p className="text-xs text-2">
              {backing.byteLength > previewLength
                ? `First ${previewLength} of ${backing.byteLength.toLocaleString()} bytes`
                : formatSize(backing.byteLength)}
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border b-4 bg-2">
            {bytes.length === 0 ? (
              <p className="p-4 text-sm text-2">Empty file</p>
            ) : (
              <table
                aria-label="File header bytes"
                className="w-full whitespace-pre text-left font-mono text-xs leading-6"
              >
                <thead className="border-b b-4 text-2">
                  <tr>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Offset
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      Hex
                    </th>
                    <th scope="col" className="px-4 py-2 font-normal">
                      ASCII
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.offset}>
                      <th scope="row" className="px-4 py-2 font-normal text-2">
                        {row.offset}
                      </th>
                      <td className="px-4 py-2">{row.hex}</td>
                      <td className="px-4 py-2">{row.ascii}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
