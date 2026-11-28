/** Read-only release visibility. Registry discovery never adds a host to the tested matrix. */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { acceptsHostVersion, compareHostVersions, policy, requiredHostPeers, validatePolicy } from './compatibility.mjs'

const ownManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
export const pluginChannel = ownManifest.publishConfig.tag

const exactVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(0|[1-9]\d*))?$/.test(value) && value.trim() === value

// Understands the current bounded generation, historical `>=x` engines.dsh,
// `*` peers and exact release lists. Anything else requires review.
function parseDeclaration(value) {
  if (typeof value !== 'string') return undefined
  if (value === '*') return () => true
  const bounded = /^>=(\S+) <(\d+\.\d+\.\d+)-0$/.exec(value)
  if (bounded && exactVersion(bounded[1])) {
    return version => acceptsHostVersion(version, value)
  }
  const lower = /^>=(\S+)$/.exec(value)
  if (lower && exactVersion(lower[1])) return version => compareHostVersions(version, lower[1]) >= 0
  const versions = value.split('||').map(v => v.trim())
  if (!versions.every(exactVersion) || new Set(versions).size !== versions.length) return undefined
  return version => versions.includes(version)
}

export function inspectUpgradeStatus({ hostTags, pluginManifest }, support = policy) {
  const supported = validatePolicy(support)
  if (!hostTags || !exactVersion(hostTags.latest)
      || !exactVersion(hostTags.next)) throw new Error('Registry must return exact latest/next host identities')
  if (pluginManifest?.name !== '@nanmicoder/dsh-agent-teams' || !exactVersion(pluginManifest.version)) throw new Error('Registry plugin identity mismatch')
  const channels = { [pluginChannel]: hostTags[pluginChannel] }
  const unverifiedChannels = Object.entries(channels).filter(([, version]) => !supported.includes(version)).map(([channel, version]) => ({ channel, version }))
  const fields = Object.hasOwn(pluginManifest.engines ?? {}, 'dsh')
    ? { 'engines.dsh': pluginManifest.engines.dsh }
    : Object.fromEntries([
      ...requiredHostPeers.filter(name => name.startsWith('@deepseek-ai/dsh-')),
      ...Object.keys(pluginManifest.peerDependencies ?? {}).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')),
    ].map(name => [name, pluginManifest.peerDependencies?.[name]]))
  const declarations = Object.entries(fields).map(([name, value]) => ({ name, accepts: parseDeclaration(value) }))
  const unrecognizedDeclarations = declarations.filter(({ accepts }) => !accepts).map(({ name }) => name)
  const accepted = version => declarations.every(({ accepts }) => accepts(version))
  // Users on these host channels cannot install the published plugin at all.
  const blockedChannels = unrecognizedDeclarations.length ? null
    : Object.entries(channels).filter(([, version]) => !accepted(version)).map(([channel, version]) => ({ channel, version }))
  const unpublishedSupport = unrecognizedDeclarations.length ? null : supported.filter(version => !accepted(version))
  return {
    needsAttention: unverifiedChannels.length > 0 || unrecognizedDeclarations.length > 0 || blockedChannels?.length > 0 || unpublishedSupport?.length > 0,
    hostChannels: channels,
    pluginChannel, pluginVersion: pluginManifest.version,
    blockedChannels, unverifiedChannels, unpublishedSupport, unrecognizedDeclarations,
    limits: ['Compares declarations only; does not prove runtime compatibility or publish anything.', 'Checks host latest/next and plugin latest; other tags and untagged releases require an explicit audit.'],
  }
}

export async function fetchUpgradeStatus(fetcher = fetch, support = policy) {
  async function read(path) {
    const response = await fetcher(`https://registry.npmjs.org/${path}`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Registry request failed: ${path}: HTTP ${response.status}`)
    return response.json()
  }
  const [hostTags, pluginManifest] = await Promise.all([
    read('-/package/@deepseek-ai%2Fdsh/dist-tags'),
    read(`@nanmicoder%2Fdsh-agent-teams/${pluginChannel}`),
  ])
  return inspectUpgradeStatus({ hostTags, pluginManifest }, support)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) throw new Error('Usage: node scripts/upgrade-status.mjs')
  const result = await fetchUpgradeStatus()
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2))
  process.exitCode = result.needsAttention ? 1 : 0
}
