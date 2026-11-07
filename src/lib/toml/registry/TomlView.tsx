import { useSignals } from '@preact/signals-react/runtime'
import type { TomlValue } from 'smol-toml'
import type { Executor } from '@src/lib/executors/registry/contract'
import { tomlParse, tomlParseOutputKey } from '@src/lib/toml/registry/tomlParse'
import { isArray, isRecord } from '@src/lib/utils'

function TableValue({ value }: { value: TomlValue }) {
  if (isArray(value) || isRecord(value)) {
    const entries = Object.entries(value)
    if (!entries.length)
      return <span className="text-chalkboard-60">Empty</span>
    return (
      <table className="w-full border-collapse text-sm">
        <tbody>
          {entries.map(([key, child]) => (
            <tr
              key={key}
              className="border-b border-chalkboard-30 dark:border-chalkboard-80"
            >
              <th scope="row" className="p-2 text-left align-top font-medium">
                {key}
              </th>
              <td className="p-2 align-top">
                <TableValue value={child} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <span className="whitespace-pre-wrap break-words">
      {typeof value === 'string' ? JSON.stringify(value) : String(value)}
    </span>
  )
}

export function TomlView({ executor }: { executor: Executor }) {
  useSignals()
  const output = executor.output.value
  const error = output.errors[tomlParse.id]
  const table = output.get(tomlParse)?.[tomlParseOutputKey]
  return (
    <article className="h-full w-full min-w-0 overflow-auto p-4">
      <h1 className="mb-4 text-lg font-medium">TOML</h1>
      {error ? (
        <p role="alert">{error.message}</p>
      ) : table ? (
        <TableValue value={table} />
      ) : (
        <p role="status">Reading TOML...</p>
      )}
    </article>
  )
}
