#!/usr/bin/env node
/** Exercise plugin routes behind the host WebServer's centralized auth policy. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { readJsonRequest, RequestBodyError } from '../lib/web-routes.js'

const ctx = new Context()
const routes = new Map()
let calls = 0
const paths = ['/plugins/dsh-agent-teams/state', '/plugins/dsh-agent-teams/plan']

const server = createServer((req, res) => {
  const route = routes.get(req.url)
  if (!route) { res.writeHead(404); res.end(); return }
  if (route.auth === 'required' && req.headers.authorization !== 'Bearer test') {
    req.resume()
    res.writeHead(401, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  Promise.resolve(route.handler(req, res)).catch(() => {
    res.writeHead(500); res.end()
  })
})

const webServer = {
  register(route) {
    assert.equal(route.auth, 'required', `${route.path} must use centralized authentication`)
    assert(!routes.has(route.path), `duplicate route: ${route.path}`)
    routes.set(route.path, route)
    return () => routes.delete(route.path)
  },
}

const routePlugin = {
  name: 'agent-teams-auth-test',
  apply(owner) {
    for (const path of paths) {
      owner.effect(() => webServer.register({
        kind: 'exact',
        path,
        auth: 'required',
        async handler(req, res) {
          if (req.method === 'POST') {
            try {
              await readJsonRequest(req, 64)
            } catch (error) {
              res.writeHead(error instanceof RequestBodyError ? error.status : 500)
              res.end()
              return
            }
          }
          calls += 1
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        },
      }))
    }
  },
}

try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const fiber = ctx.plugin(routePlugin)
  await fiber

  for (const path of paths) {
    const response = await fetch(base + path, { method: path.endsWith('/plan') ? 'POST' : 'GET' })
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  assert.equal(calls, 0, 'unauthenticated requests must not read or mutate team state')

  for (const path of paths) {
    const response = await fetch(base + path, {
      method: path.endsWith('/plan') ? 'POST' : 'GET',
      headers: { authorization: 'Bearer test' },
      ...(path.endsWith('/plan') ? { body: '{}' } : {}),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  }
  assert.equal(calls, 2)

  const unauthenticatedUpload = await fetch(base + paths[1], { method: 'POST', body: 'x'.repeat(65) })
  assert.equal(unauthenticatedUpload.status, 401, 'authentication runs before parsing request bodies')
  await unauthenticatedUpload.arrayBuffer()
  const oversized = await fetch(base + paths[1], {
    method: 'POST', headers: { authorization: 'Bearer test' }, body: 'x'.repeat(65),
  })
  assert.equal(oversized.status, 413, 'authorized oversized requests fail before mutating team state')
  await oversized.arrayBuffer()
  assert.equal(calls, 2)

  await fiber.dispose()
  assert(paths.every(path => !routes.has(path)), 'unload removes every owned route')
  const reloaded = ctx.plugin(routePlugin)
  await reloaded
  assert(paths.every(path => routes.has(path)), 'reload restores exactly one registration')
  await reloaded.dispose()
  console.log('PASS Web routes: centralized auth policy, bounded bodies, disposal and reload')
} finally {
  await ctx.fiber.dispose()
  server.closeAllConnections()
  if (server.listening) await new Promise(resolve => server.close(resolve))
}
