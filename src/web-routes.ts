import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Public WebServer route surface used by the plugin. */
export interface WebRouteHost {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * rc.3 admission face. `HostConnectionService.admit` re-enters cordis's traced
 * service proxy and demands the caller inject `connection.authentication`,
 * which this plugin cannot hard-require (headless profiles mount no web stack).
 * The nested credential registry answers the same verdict without the inject
 * demand; the Host/Origin fence itself moved to the webserver's centralized
 * `webserver/authorize` step in rc.3. Declared structurally so the plugin
 * typechecks against any 0.2.x peer resolution.
 */
export interface BrowserRequestGate {
  authenticate(request: IncomingMessage): BrowserRequestVerdict
}

/**
 * Released 0.2.x face. npm `dsh-client-connection` (through 0.2.2-rc.5) ships
 * no `connection.authentication` registry; its `HostConnectionService` answers
 * with the bare rejection status (401 | 403 | undefined) through
 * `requestRejection`. The fork's source deployment mounts the rc.3 registry
 * and matches the primary face above.
 */
export interface LegacyBrowserRequestGate {
  requestRejection(request: IncomingMessage): 401 | 403 | undefined
}

/**
 * 0.2.2-rc.5 face. `HostConnectionService.admit` applies the source policy and
 * answers a `PeerAdmission`: `{ peer }` admits, `{ rejection }` denies with the
 * HTTP status.
 */
export interface AdmitBrowserRequestGate {
  admit(request: IncomingMessage): { peer?: unknown } | { rejection: 401 | 403 | 503 }
}

/** Adapts either live Connection face to the primary gate. */
export function normalizeBrowserRequestGate(service: unknown): BrowserRequestGate | undefined {
  const candidate = service as Partial<BrowserRequestGate & LegacyBrowserRequestGate & AdmitBrowserRequestGate> | undefined
  if (candidate === null || typeof candidate !== 'object') return undefined
  const authenticate = candidate.authenticate?.bind(candidate)
  if (typeof authenticate === 'function') return { authenticate: (request) => authenticate(request) }
  const requestRejection = candidate.requestRejection?.bind(candidate)
  if (typeof requestRejection === 'function') {
    return {
      // The service method is extracted, so bind it back or `this` is lost;
      // it answers with the bare status, undefined meaning "may proceed".
      authenticate: (request: IncomingMessage): BrowserRequestVerdict => {
        const rejection = requestRejection(request)
        return rejection === undefined ? { peer: undefined } : { rejection }
      },
    }
  }
  const admit = candidate.admit?.bind(candidate)
  if (typeof admit === 'function') {
    return {
      // 0.2.2-rc.5 face: admit applies the source policy and answers a
      // PeerAdmission; a rejection denies, a peer admits.
      authenticate: (request: IncomingMessage): BrowserRequestVerdict => {
        const admission = admit(request)
        return 'rejection' in admission ? { rejection: admission.rejection } : { peer: admission.peer }
      },
    }
  }
  return undefined
}

/** Credential verdict: a live peer serves; anything else is a refusal. */
export type BrowserRequestVerdict =
  | { peer: unknown }
  | { rejection: 401 | 403 | 503 }

export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message)
  }
}

/** Bound memory while draining oversized requests so the route can return 413. */
export async function readJsonRequest(req: IncomingMessage, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const raw = await new Promise<string>((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks: Buffer[] = []
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('aborted', onAborted)
      req.off('error', onError)
      if (error) {
        chunks.length = 0
        // IncomingMessage may still receive data; discard it without buffering.
        req.once('error', () => {})
        req.resume()
        reject(error)
      } else {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
    }
    const onData = (chunk: Buffer | string): void => {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += part.length
      if (size > maxBytes) finish(new RequestBodyError('request body is too large', 413))
      else chunks.push(part)
    }
    const onEnd = (): void => finish()
    const onAborted = (): void => finish(new RequestBodyError('request body was aborted', 400))
    const onError = (): void => finish(new RequestBodyError('invalid request body', 400))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('aborted', onAborted)
    req.once('error', onError)
  })
  let value: unknown
  try {
    value = raw.trim() === '' ? {} : JSON.parse(raw)
  } catch {
    throw new RequestBodyError('invalid JSON', 400)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestBodyError('body must be an object', 400)
  }
  return value as Record<string, unknown>
}

function matchesEntityTagList(header: string | undefined, tag: string): boolean {
  if (header === undefined) return false
  if (header.trim() === '*') return true
  // A comma can be part of the quoted opaque tag. Consume whole list entries
  // and compare their quoted values, accepting either weak or strong spelling.
  const entry = /[ \t]*(?:(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*"))?[ \t]*(?:,|$)/y
  let matched = false
  while (entry.lastIndex < header.length) {
    const parsed = entry.exec(header)
    if (parsed === null) return false
    matched ||= parsed[1] === tag
  }
  return matched
}

/** Revalidate a current JSON representation across both identity and gzip delivery. */
export function writeJsonWithEtag(req: IncomingMessage, res: ServerResponse, body: string): void {
  const tag = `"${createHash('sha256').update(body).digest('base64url')}"`
  const headers = { 'cache-control': 'no-store', etag: `W/${tag}` }
  if ((req.method === 'GET' || req.method === 'HEAD')
    && matchesEntityTagList(req.headers['if-none-match'], tag)) {
    res.writeHead(304, headers)
    res.end()
    return
  }
  res.writeHead(200, { ...headers, 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

/** Raw WebServer routes do not inherit Connection's authentication fence. */
export function authenticatedWebRoutes(
  server: WebRouteHost,
  connection: () => BrowserRequestGate | undefined,
): WebRouteHost {
  return {
    register(route) {
      return server.register({
        ...route,
        async handler(req, res) {
          const gate = connection()
          // Missing/disposing registry is an assembly failure, never an
          // invitation to expose workspace state or accept plan mutations.
          // The verdict comes from Connection's own credential registry; the
          // Host/Origin fence already ran in the webserver's authorize step.
          // The verdict is a live peer or a rejection; an unexpected answer
          // is a refusal, never a pass.
          const verdict = gate?.authenticate(req)
          const rejection = verdict === undefined || 'peer' in verdict
            ? (verdict === undefined ? 503 : undefined)
            : verdict.rejection
          if (rejection !== undefined) {
            res.writeHead(rejection, {
              'content-type': 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            })
            res.end(JSON.stringify({ error: rejection === 503 ? 'authentication unavailable'
              : rejection === 401 ? 'unauthorized' : 'forbidden' }))
            return
          }
          await route.handler(req, res)
        },
      })
    },
  }
}
