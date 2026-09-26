import { describe, it, expect } from 'vitest'
import {
  computeShrinkSize,
  MAX_UPLOAD_SIDE,
  JPEG_QUALITY,
} from '../../lib/image-resize'

describe('computeShrinkSize', () => {
  it('does not upscale small images', () => {
    expect(computeShrinkSize(800, 600)).toEqual({
      width: 800,
      height: 600,
      scaled: false,
    })
  })

  it('scales a large landscape photo to the max side', () => {
    const result = computeShrinkSize(4000, 3000)
    expect(result.scaled).toBe(true)
    expect(result.width).toBe(MAX_UPLOAD_SIDE)
    expect(result.height).toBe(1200)
  })

  it('scales a large portrait photo on its longest side', () => {
    const result = computeShrinkSize(3000, 4000)
    expect(result.scaled).toBe(true)
    expect(result.height).toBe(MAX_UPLOAD_SIDE)
    expect(result.width).toBe(1200)
  })

  it('preserves aspect ratio (within rounding)', () => {
    const result = computeShrinkSize(3840, 2160)
    expect(result.scaled).toBe(true)
    expect(result.width / result.height).toBeCloseTo(3840 / 2160, 2)
  })

  it('treats an image exactly at the limit as unscaled', () => {
    expect(computeShrinkSize(1600, 1000).scaled).toBe(false)
  })

  it('honours a custom max side', () => {
    expect(computeShrinkSize(2000, 1000, 1000)).toEqual({
      width: 1000,
      height: 500,
      scaled: true,
    })
  })

  it('never returns a zero dimension', () => {
    const result = computeShrinkSize(5000, 1)
    expect(result.width).toBe(MAX_UPLOAD_SIDE)
    expect(result.height).toBeGreaterThanOrEqual(1)
  })

  it('uses a JPEG quality that keeps uploads small', () => {
    expect(JPEG_QUALITY).toBeLessThanOrEqual(0.9)
  })
})
