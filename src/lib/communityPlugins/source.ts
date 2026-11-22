import { isErr } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import { parse as parseToml } from 'smol-toml'

/** Parsed declarations bound what a runtime may request; installation grants are kept separately. */
export interface PluginManifest {
  id: string
  name: string
  description?: string
  apiVersion: 1
  permissions: readonly string[]
}

export interface PluginSource {
  manifest: PluginManifest
  javascript: string
  source: string
}

export const matchesPluginSource = ({ src }: { src: string }) =>
  /\.zds\.[jt]s$/i.test(src)

export function parsePluginManifest(source: string): PluginManifest | Error {
  const header = /^\s*\/\*\s*@zds-plugin\s*\r?\n([\s\S]*?)\*\//.exec(source)
  if (!header)
    return new Error('Start the file with an @zds-plugin TOML block.')
  try {
    const value = parseToml(header[1])
    if (
      typeof value.id !== 'string' ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(value.id) ||
      typeof value.name !== 'string' ||
      !value.name.trim() ||
      value.name.length > 120 ||
      value.api_version !== 1 ||
      !isArray(value.permissions) ||
      !value.permissions.every((entry) => typeof entry === 'string')
    ) {
      return new Error(
        'Expected id, name, api_version = 1, and a permissions array.'
      )
    }
    if (
      value.description !== undefined &&
      (typeof value.description !== 'string' || value.description.length > 2000)
    )
      return new Error(
        'Plugin description must be text of at most 2000 characters.'
      )
    if (
      Object.keys(value).some(
        (key) =>
          !['id', 'name', 'description', 'api_version', 'permissions'].includes(
            key
          )
      )
    ) {
      return new Error('Unknown plugin manifest field.')
    }
    return {
      id: value.id,
      name: value.name,
      ...(typeof value.description === 'string' && value.description.trim()
        ? { description: value.description.trim() }
        : {}),
      apiVersion: 1,
      permissions: [...new Set(value.permissions)],
    }
  } catch (cause) {
    return new Error(
      `Invalid plugin TOML: ${isErr(cause) ? cause.message : String(cause)}`
    )
  }
}

/** Compilation inspects source but never executes it. Type-only SDK imports disappear here. */
export async function compilePlugin(
  source: string
): Promise<PluginSource | Error> {
  if (source.length > 128_000) return new Error('Plugin source exceeds 128 KB.')
  const manifest = parsePluginManifest(source)
  if (isErr(manifest)) return manifest
  try {
    const { transform } = await import('sucrase')
    const { code } = transform(source, {
      transforms: ['typescript', 'imports'],
      filePath: `${manifest.id}.zds.ts`,
    })
    return { manifest, javascript: code, source }
  } catch (cause) {
    return new Error(
      `Plugin compilation failed: ${isErr(cause) ? cause.message : String(cause)}`
    )
  }
}
