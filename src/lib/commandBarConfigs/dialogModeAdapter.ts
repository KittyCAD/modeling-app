export type DialogArguments = Record<string, unknown>

type DialogModeTuple = readonly [string, ...string[]]

type DialogArgumentPatch<Args extends object> = {
  [Key in keyof Args]?: Args[Key] | undefined
}

export interface DialogModeAdapter<
  Key extends string,
  Modes extends DialogModeTuple,
> {
  readonly key: Key
  readonly modes: Modes
  isMode: (value: unknown) => value is Modes[number]
  get: (argumentsToSubmit: DialogArguments) => Modes[number] | undefined
  normalize: (
    argumentsToSubmit: DialogArguments,
    selectedMode?: Modes[number]
  ) => DialogArguments & Record<Key, Modes[number] | undefined>
}

/**
 * Bridges a user-facing dialog mode to the raw arguments accepted by KCL.
 * Explicit valid modes take precedence so drafts can switch modes without
 * stale raw arguments changing the selection.
 */
export function createDialogModeAdapter<
  const Key extends string,
  const Modes extends DialogModeTuple,
>({
  key,
  modes,
  infer,
  toRaw,
}: {
  key: Key
  modes: Modes
  infer: (argumentsToSubmit: DialogArguments) => Modes[number] | undefined
  toRaw?: (
    mode: Modes[number],
    argumentsToSubmit: DialogArguments
  ) => DialogArguments
}): DialogModeAdapter<Key, Modes> {
  const isMode = (value: unknown): value is Modes[number] =>
    typeof value === 'string' && modes.some((mode) => mode === value)

  const get = (
    argumentsToSubmit: DialogArguments
  ): Modes[number] | undefined => {
    const explicitMode = argumentsToSubmit[key]
    return isMode(explicitMode) ? explicitMode : infer(argumentsToSubmit)
  }

  const normalize = (
    argumentsToSubmit: DialogArguments,
    selectedMode = get(argumentsToSubmit)
  ): DialogArguments & Record<Key, Modes[number] | undefined> => {
    const normalized: DialogArguments = {
      ...argumentsToSubmit,
      [key]: selectedMode,
    }

    if (selectedMode !== undefined && toRaw !== undefined) {
      Object.assign(normalized, toRaw(selectedMode, normalized))
      normalized[key] = selectedMode
    }

    return normalized as DialogArguments &
      Record<Key, Modes[number] | undefined>
  }

  return { key, modes, isMode, get, normalize }
}

/**
 * Bind an adapter definition to a command's argument schema. This catches
 * misspelled mode/raw argument names while the returned adapter remains able
 * to consume the command bar's dynamic argument record at runtime.
 */
export function createDialogModeAdapterFor<Args extends object>() {
  return <
    const Key extends Extract<keyof Args, string>,
    const Mode extends Extract<NonNullable<Args[Key]>, string>,
    const Modes extends readonly [Mode, ...Mode[]],
  >({
    key,
    modes,
    infer,
    toRaw,
  }: {
    key: Key
    modes: Modes
    infer: (
      argumentsToSubmit: Readonly<Partial<Args>>
    ) => Modes[number] | undefined
    toRaw?: (
      mode: Modes[number],
      argumentsToSubmit: Readonly<Partial<Args>>
    ) => DialogArgumentPatch<Args>
  }): DialogModeAdapter<Key, Modes> =>
    createDialogModeAdapter({
      key,
      modes,
      infer: (argumentsToSubmit) =>
        infer(argumentsToSubmit as Readonly<Partial<Args>>),
      toRaw: toRaw
        ? (mode, argumentsToSubmit) =>
            toRaw(
              mode,
              argumentsToSubmit as Readonly<Partial<Args>>
            ) as DialogArguments
        : undefined,
    })
}
