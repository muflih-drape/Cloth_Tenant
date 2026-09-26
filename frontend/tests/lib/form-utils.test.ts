import { describe, it, expect } from 'vitest'
import { objectToFormData, fabricToFormData } from '../../lib/form-utils'

describe('objectToFormData', () => {
  it('converts a simple key-value object', () => {
    const result = objectToFormData({ name: 'Test', age: 25 })
    expect(result.get('name')).toBe('Test')
    expect(result.get('age')).toBe('25')
  })

  it('handles nested objects with bracket notation', () => {
    const result = objectToFormData({
      user: { name: 'John', email: 'john@example.com' }
    })
    expect(result.get('user[name]')).toBe('John')
    expect(result.get('user[email]')).toBe('john@example.com')
  })

  it('handles arrays with index notation', () => {
    const result = objectToFormData({
      items: ['apple', 'banana', 'cherry']
    })
    expect(result.get('items[0]')).toBe('apple')
    expect(result.get('items[1]')).toBe('banana')
    expect(result.get('items[2]')).toBe('cherry')
  })

  it('handles nested arrays in objects', () => {
    const result = objectToFormData({
      variants: [
        { metres: ['0.5', '1.5'] },
        { metres: ['2.5'] }
      ]
    })
    expect(result.get('variants[0][metres][0]')).toBe('0.5')
    expect(result.get('variants[0][metres][1]')).toBe('1.5')
    expect(result.get('variants[1][metres][0]')).toBe('2.5')
  })

  it('skips null and undefined values', () => {
    const result = objectToFormData({
      name: 'Test',
      empty: null,
      alsoEmpty: undefined
    })
    expect(result.get('name')).toBe('Test')
    expect(result.get('empty')).toBeNull()
    expect(result.get('alsoEmpty')).toBeNull()
  })

  it('respects ignoreList parameter', () => {
    const result = objectToFormData(
      { name: 'Test', secret: 'hidden', password: '123' },
      undefined,
      ['secret', 'password']
    )
    expect(result.get('name')).toBe('Test')
    expect(result.get('secret')).toBeNull()
    expect(result.get('password')).toBeNull()
  })

  it('handles File objects', () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' })
    const result = objectToFormData({ file })
    expect(result.get('file')).toBe(file)
  })

  it('handles empty objects', () => {
    const result = objectToFormData({})
    expect(Array.from(result.entries()).length).toBe(0)
  })

  it('handles empty arrays', () => {
    const result = objectToFormData({ items: [] })
    expect(Array.from(result.entries()).length).toBe(0)
  })
})

describe('fabricToFormData', () => {
  it('converts a fabric structure to Django FormData', () => {
    const fabric = {
      name: 'Cotton Lawn',
      description: 'Fine weave, 60 GSM',
      price_per_meter: '185.50',
      variants: [
        { image: null, display_order: 'Red', stock_meters: '2400' },
        { image: null, display_order: 'Blue', stock_meters: '900' }
      ]
    }

    const result = fabricToFormData(fabric)
    expect(result.get('name')).toBe('Cotton Lawn')
    expect(result.get('description')).toBe('Fine weave, 60 GSM')
    expect(result.get('price_per_meter')).toBe('185.50')
    expect(result.get('variants[0]display_order')).toBe('Red')
    expect(result.get('variants[0]stock_meters')).toBe('2400')
    expect(result.get('variants[1]display_order')).toBe('Blue')
    expect(result.get('variants[1]stock_meters')).toBe('900')
  })

  it('sends the id only for colours that already exist', () => {
    const result = fabricToFormData({
      name: 'Linen',
      description: '',
      price_per_meter: '240',
      variants: [
        { id: 7, display_order: 'Natural' },
        { display_order: 'Sage', stock_meters: '50' }
      ]
    })

    expect(result.get('variants[0]id')).toBe('7')
    expect(result.get('variants[1]id')).toBeNull()
  })

  it('omits stock_meters for existing colours so an edit cannot overwrite live stock', () => {
    const result = fabricToFormData({
      name: 'Linen',
      description: '',
      price_per_meter: '240',
      variants: [{ id: 7, display_order: 'Natural', stock_meters: '9999' }]
    })

    expect(result.get('variants[0]stock_meters')).toBeNull()
  })

  it('handles a variant with an image file', () => {
    const file = new File(['image'], 'red.png', { type: 'image/png' })
    const result = fabricToFormData({
      name: 'Denim',
      description: '',
      price_per_meter: '320',
      variants: [{ image: file, display_order: 'Indigo', stock_meters: '10' }]
    })

    expect(result.get('variants[0]image')).toBe(file)
  })

  it('uses an empty string for a missing description', () => {
    const result = fabricToFormData({
      name: 'Silk',
      description: undefined,
      price_per_meter: '999',
      variants: []
    })

    expect(result.get('description')).toBe('')
    expect(result.get('price_per_meter')).toBe('999')
  })

  it('sends a replaced image as a real file, not a serialised {}', () => {
    // Regression: sending this payload as JSON turns the File into `{}`, and
    // the API answers "The submitted data was not a file."
    const file = new File(['image-bytes'], 'navy.png', { type: 'image/png' })
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [{ id: 7, image: file, display_order: 'Navy' }]
    })

    const sent = result.get('variants[0]image')
    expect(sent).toBe(file)
    expect(sent).toBeInstanceOf(File)
  })

  it('never sends an existing image URL back as an upload', () => {
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [
        { id: 7, image: 'http://localhost:8000/media/navy.jpg', display_order: 'Navy' }
      ]
    })

    expect(result.get('variants[0]image')).toBeNull()
  })

  it('sends remove_image so a cleared photo is actually cleared', () => {
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [{ id: 7, image: null, remove_image: true, display_order: 'Navy' }]
    })

    expect(result.get('variants[0]remove_image')).toBe('true')
  })

  it('omits remove_image when the photo is being kept', () => {
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [{ id: 7, display_order: 'Navy' }]
    })

    expect(result.get('variants[0]remove_image')).toBeNull()
  })

  it('sends a blank display_order so a cleared label is actually cleared', () => {
    // The API only rewrites a label when the key is present, so skipping a
    // blank one would leave the old label behind.
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [{ id: 7, display_order: null }]
    })

    expect(result.get('variants[0]display_order')).toBe('')
  })

  it('sends a blank display_order for a spaces-only label', () => {
    const result = fabricToFormData({
      name: 'Cotton',
      description: '',
      price_per_meter: '150',
      variants: [{ id: 7, display_order: '   ' }]
    })

    expect(result.get('variants[0]display_order')).toBe('   ')
  })
})
