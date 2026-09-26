import { describe, it, expect } from 'vitest'
import {
  variantOrderValue,
  compareByVariantOrder,
} from '../../lib/sortVariants'

describe('variantOrderValue', () => {
  it('parses numeric display_order as-is', () => {
    expect(variantOrderValue(2)).toBe(2)
    expect(variantOrderValue('10')).toBe(10)
  })

  it('maps null/blank/non-numeric to MAX_SAFE_INTEGER (sorted last)', () => {
    expect(variantOrderValue(null)).toBe(Number.MAX_SAFE_INTEGER)
    expect(variantOrderValue(undefined)).toBe(Number.MAX_SAFE_INTEGER)
    expect(variantOrderValue('')).toBe(Number.MAX_SAFE_INTEGER)
    expect(variantOrderValue('abc')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('compareByVariantOrder', () => {
  it('sorts numerically ascending', () => {
    const variants = [
      { display_order: '10' },
      { display_order: '2' },
      { display_order: '1' },
    ].sort(compareByVariantOrder)
    expect(variants.map((v) => v.display_order)).toEqual(['1', '2', '10'])
  })

  it('sorts variants without display_order last', () => {
    const variants = [
      { display_order: null as string | null },
      { display_order: '2' },
      { display_order: undefined as string | null | undefined },
      { display_order: '1' },
    ].sort(compareByVariantOrder)
    expect(variants.slice(0, 2).map((v) => v.display_order)).toEqual([
      '1',
      '2',
    ])
    expect(variants[2].display_order).toBe(null)
    expect(variants[3].display_order).toBe(undefined)
  })
})