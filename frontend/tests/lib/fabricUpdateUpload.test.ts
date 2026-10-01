import { describe, it, expect } from 'vitest'
import type { AxiosHeaders, AxiosRequestConfig } from 'axios'
import { api } from '../../lib/api/axios'
import { buildFabricUpdatePayload } from '../../lib/updateItem'
import { fabricToFormData } from '../../lib/form-utils'
import type { EditableVariant } from '../../types/item'

// Runs the genuine axios pipeline (interceptors -> transformRequest -> adapter)
// and captures exactly what would go over the wire.
async function captureRequest(data: unknown) {
  let captured: AxiosRequestConfig | null = null
  const adapter = async (config: AxiosRequestConfig) => {
    captured = config
    return {
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const original = api.defaults.adapter
  api.defaults.adapter = adapter as never
  try {
    await api.put('/api/items/10/', data)
  } finally {
    api.defaults.adapter = original
  }
  return captured!
}

describe('fabric edit upload', () => {
  it('sends real multipart with the File intact', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'black.png', {
      type: 'image/png',
    })

    const variants: EditableVariant[] = [
      {
        backendId: 31,
        localId: 'c1',
        stockMeters: '0',
        displayOrder: 'Black',
        imageUrl: 'http://localhost:8000/media/fabrics/10/old-black.jpg',
        newImage: file,
        imagePreview: 'blob:preview',
      },
      {
        backendId: 30,
        localId: 'c2',
        stockMeters: '0',
        displayOrder: 'White',
        imageUrl: null,
        newImage: null,
        imagePreview: null,
      },
      {
        backendId: 29,
        localId: 'c3',
        stockMeters: '0',
        displayOrder: 'Navy Blue',
        imageUrl: null,
        newImage: null,
        imagePreview: null,
      },
    ]

    const fd = fabricToFormData(
      buildFabricUpdatePayload(
        { name: 'Rayon Challis', description: 'Printed challis, dresses', price_per_meter: '6.90' },
        variants,
      ),
    )

    const captured = await captureRequest(fd)

    // The body must still be FormData, not re-serialised JSON.
    expect(captured.data).toBeInstanceOf(FormData)

    const sent = captured.data as FormData
    const sentContentType = String(
      (captured.headers as unknown as AxiosHeaders)?.get?.('Content-Type') ?? '',
    )
    expect(sentContentType).not.toContain('application/json')

    // The photo arrives as a real file, which is what the FileField needs.
    const image = sent.get('variants[0]image')
    expect(image).toBeInstanceOf(File)
    expect((image as File).name).toBe('black.png')

    // And the rest of the edit is intact.
    expect(sent.get('name')).toBe('Rayon Challis')
    expect(sent.get('variants[0]id')).toBe('31')
    expect(sent.get('variants[0]display_order')).toBe('Black')
    expect(sent.get('variants[1]remove_image')).toBe('true')
    expect(sent.get('variants[1]display_order')).toBe('White')
    expect(sent.get('variants[2]remove_image')).toBe('true')
    // Existing colours send stock back too, so a correction in the row lands.
    expect(sent.get('variants[0]stock_meters')).toBe('0')
  })
})
