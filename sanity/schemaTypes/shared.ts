export const OWNER_KINDS = ['client', 'designer', 'workshop'] as const
export const REMNANT_STATUSES = [
  'intake',
  'consented',
  'listed',
  'allocated',
  'sold-out',
  'returned',
] as const
export const TEMPLATE_KINDS = ['cushion', 'bench-pad', 'lumbar', 'seat-pad', 'tote'] as const

export const enumOptions = (values: readonly string[]) => ({
  list: values.map((value) => ({
    title: value
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    value,
  })),
})

type RequiredRule<T> = {required: () => T}

export const enumValidation = <T extends RequiredRule<T>>(rule: T, values: readonly string[]): T => {
  const withValues = rule.required() as T & {valid: (value: unknown | unknown[]) => T}
  return withValues.valid([...values])
}

export const nonNegative = <T extends RequiredRule<T> & {min: (value: number) => T}>(rule: T): T => rule.required().min(0)
export const positive = <T extends RequiredRule<T> & {positive: () => T}>(rule: T): T => rule.required().positive()
export const nonNegativeInteger = <
  T extends RequiredRule<T> & {integer: () => T; min: (value: number) => T},
>(rule: T): T => rule.required().integer().min(0)
export const positiveInteger = <T extends RequiredRule<T> & {positive: () => T; integer: () => T}>(rule: T): T =>
  rule.required().positive().integer()
