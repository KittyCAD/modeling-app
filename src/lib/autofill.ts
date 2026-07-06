export const noAutofillFormProps = {
  autoComplete: 'off',
  'data-form-type': 'other',
} as const

export const noAutofillInputProps = {
  autoCapitalize: 'off',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': 'true',
  'data-op-ignore': 'true',
  'data-lpignore': 'true',
  'data-form-type': 'other',
  'data-bwignore': 'true',
  'data-protonpass-ignore': 'true',
} as const

const noAutofillAttributes = {
  autocapitalize: noAutofillInputProps.autoCapitalize,
  autocomplete: noAutofillInputProps.autoComplete,
  autocorrect: noAutofillInputProps.autoCorrect,
  spellcheck: String(noAutofillInputProps.spellCheck),
  'data-1p-ignore': noAutofillInputProps['data-1p-ignore'],
  'data-op-ignore': noAutofillInputProps['data-op-ignore'],
  'data-lpignore': noAutofillInputProps['data-lpignore'],
  'data-form-type': noAutofillInputProps['data-form-type'],
  'data-bwignore': noAutofillInputProps['data-bwignore'],
  'data-protonpass-ignore': noAutofillInputProps['data-protonpass-ignore'],
} as const

export function setNoAutofillAttributes(element?: HTMLElement | null) {
  if (!element) {
    return
  }

  for (const [attribute, value] of Object.entries(noAutofillAttributes)) {
    element.setAttribute(attribute, value)
  }
}
