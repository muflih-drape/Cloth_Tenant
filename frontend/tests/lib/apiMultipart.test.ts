import { describe, it, expect } from 'vitest'
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios'
import { api } from '../../lib/api/axios'

type RequestInterceptor = (
  config: InternalAxiosRequestConfig,
) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>

/** The first registered request interceptor, i.e. the one in lib/api/axios.ts. */
function firstRequestInterceptor(): RequestInterceptor {
  const manager = api.interceptors.request as unknown as {
    handlers: Array<{ fulfilled: RequestInterceptor }>
  }
  return manager.handlers[0].fulfilled
}

/**
 * The instance sets a JSON content type as a default, and axios merges instance
 * defaults into every request. So a FormData body inherits it, and axios then
 * flattens the FormData back into JSON -- turning every File into `{}`. The
 * request still "succeeds" at the transport layer and only fails server-side
 * with "The submitted data was not a file", so it has to be caught here.
 */
async function runRequestInterceptor(data: unknown) {
  const config = {
    data,
    headers: new AxiosHeaders({
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true',
      Authorization: 'Bearer token',
    }),
  } as unknown as InternalAxiosRequestConfig

  return firstRequestInterceptor()(config)
}

describe('multipart requests', () => {
  it('strips the JSON content type from a FormData body', async () => {
    const config = await runRequestInterceptor(new FormData())

    expect(String(config.headers.get('Content-Type'))).not.toContain(
      'application/json',
    )
  })

  it('keeps the JSON content type for ordinary JSON bodies', async () => {
    const config = await runRequestInterceptor({ name: 'Rayon Challis' })

    expect(config.headers.get('Content-Type')).toBe('application/json')
  })

  it('handles a plain-object header bag that has no delete method', async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    const config = {
      data: new FormData(),
      headers,
    } as unknown as InternalAxiosRequestConfig

    await firstRequestInterceptor()(config)

    expect(headers['Content-Type']).toBeUndefined()
  })

  it('leaves every other header alone', async () => {
    const config = await runRequestInterceptor(new FormData())

    expect(config.headers.get('ngrok-skip-browser-warning')).toBe('true')
    expect(config.headers.get('Authorization')).toBe('Bearer token')
  })
})
