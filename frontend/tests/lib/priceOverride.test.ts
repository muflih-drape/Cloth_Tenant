import { describe, it, expect } from 'vitest'
import {
  validatePriceOverride,
  validateOverrideReason,
  hasMeaningfulChange,
  discountPercent,
  formatRupees,
} from '../../lib/priceOverride'

describe('validatePriceOverride', () => {
  it('accepts a discount below the order total', () => {
    const result = validatePriceOverride({
      raw: '8000',
      computedTotal: 9000,
      canRaise: false,
    })

    expect(result).toEqual({ ok: true, total: 8000 })
  })

  it('accepts a total equal to the order total', () => {
    const result = validatePriceOverride({
      raw: '9000.00',
      computedTotal: 9000,
      canRaise: false,
    })

    expect(result).toEqual({ ok: true, total: 9000 })
  })

  it('rejects an agent raising the total above the order total', () => {
    const result = validatePriceOverride({
      raw: '9500',
      computedTotal: 9000,
      canRaise: false,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('9,000.00')
  })

  it('lets an admin raise the total', () => {
    const result = validatePriceOverride({
      raw: '9500',
      computedTotal: 9000,
      canRaise: true,
    })

    expect(result).toEqual({ ok: true, total: 9500 })
  })

  it('rejects an empty field', () => {
    for (const raw of ['', '   ']) {
      const result = validatePriceOverride({ raw, computedTotal: 9000, canRaise: false })
      expect(result).toEqual({ ok: false, error: 'Enter a total' })
    }
  })

  it('rejects a negative total', () => {
    const result = validatePriceOverride({ raw: '-100', computedTotal: 9000, canRaise: false })

    expect(result).toEqual({ ok: false, error: 'The total cannot be negative' })
  })

  it('rejects anything that is not a plain amount', () => {
    // "12abc" and "1e5" both reach Number() as finite numbers, so the shape has
    // to be checked rather than trusting parseFloat.
    for (const raw of ['12abc', '1e5', '9,000', '1.234', '--5', 'NaN', 'Infinity']) {
      const result = validatePriceOverride({ raw, computedTotal: 9000, canRaise: true })
      expect(result.ok).toBe(false)
    }
  })

  it('accepts zero', () => {
    const result = validatePriceOverride({ raw: '0', computedTotal: 9000, canRaise: false })

    expect(result).toEqual({ ok: true, total: 0 })
  })

  it('accepts up to two decimals', () => {
    const result = validatePriceOverride({ raw: '8123.45', computedTotal: 9000, canRaise: false })

    expect(result).toEqual({ ok: true, total: 8123.45 })
  })

  it('tolerates surrounding whitespace', () => {
    const result = validatePriceOverride({ raw: ' 8000 ', computedTotal: 9000, canRaise: false })

    expect(result).toEqual({ ok: true, total: 8000 })
  })

  it('caps an agent at zero when there are no lines to discount', () => {
    // An empty order computes to 0, so any positive agent total is above it.
    const blocked = validatePriceOverride({ raw: '100', computedTotal: 0, canRaise: false })
    expect(blocked.ok).toBe(false)

    const allowed = validatePriceOverride({ raw: '0', computedTotal: 0, canRaise: false })
    expect(allowed).toEqual({ ok: true, total: 0 })
  })
})

describe('validateOverrideReason', () => {
  it('accepts an empty reason, because it is optional', () => {
    expect(validateOverrideReason('')).toBeNull()
    expect(validateOverrideReason('   ')).toBeNull()
  })

  it('accepts a reason within the limit', () => {
    expect(validateOverrideReason('Negotiated rate')).toBeNull()
    expect(validateOverrideReason('x'.repeat(200))).toBeNull()
  })

  it('rejects a reason over 200 characters', () => {
    expect(validateOverrideReason('x'.repeat(201))).toContain('200')
  })
})

describe('hasMeaningfulChange', () => {
  it('is false when nothing would change', () => {
    expect(hasMeaningfulChange(9000, 9000, false)).toBe(false)
  })

  it('is true when the total differs', () => {
    expect(hasMeaningfulChange(8000, 9000, false)).toBe(true)
  })

  it('is true when posting the order total would clear an existing override', () => {
    // The save has to stay enabled, or there is no way to undo an adjustment.
    expect(hasMeaningfulChange(9000, 9000, true)).toBe(true)
  })

  it('ignores floating point noise', () => {
    expect(hasMeaningfulChange(8123.4500001, 8123.45, false)).toBe(false)
  })
})

describe('discountPercent', () => {
  it('reports the discount as a whole percentage', () => {
    expect(discountPercent(8000, 9000)).toBe(11)
    expect(discountPercent(9000, 9000)).toBe(0)
  })

  it('is zero when there is nothing to discount', () => {
    expect(discountPercent(500, 0)).toBe(0)
  })

  it('is zero when the total was raised', () => {
    expect(discountPercent(9500, 9000)).toBe(0)
  })
})

describe('formatRupees', () => {
  it('always shows two decimals', () => {
    expect(formatRupees(9000)).toBe('₹9,000.00')
    expect(formatRupees(8123.456)).toBe('₹8,123.46')
  })

  it('treats a missing value as zero', () => {
    expect(formatRupees(NaN)).toBe('₹0.00')
  })
})
