import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReleaseTagTarget, releaseMetadata } from './release-metadata.mjs'
import { policy, workspacePolicy } from './compatibility.mjs'

const fixture = (version, tag) => ({
  ...JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
  version, publishConfig: { tag },
})

test('an alpha-only development baseline cannot publish to latest', () => {
  assert.throws(
    () => releaseMetadata(fixture('0.1.32', 'latest')),
    /latest requires a non-Alpha\/Beta development host/,
  )
  assert.throws(() => releaseMetadata(fixture('0.1.32-alpha.1', 'next'), {
    ...policy,
    recommendedHost: '0.2.3-alpha.2',
  }), /Alpha\/beta/)
})

for (const suffix of ['alpha', 'beta', 'rc']) {
  test(`${suffix} candidates use next and never replace latest`, () => {
    const version = `0.1.16-${suffix}.1`
    assert.equal(releaseMetadata(fixture(version, 'next')).prerelease, true)
    for (const tag of [undefined, 'latest', suffix]) {
      assert.throws(() => releaseMetadata(fixture(version, tag)), /publishConfig.tag/)
    }
  })
}

test('reject unsupported versions and bounded or listed peers', () => {
  for (const version of ['0.1.16-dev.1', '0.1.16-alpha.01', '0.1.16-alpha.1\n', 'v0.1.16', '0.1']) {
    assert.throws(() => releaseMetadata(fixture(version, 'next')))
  }
  const mixed = fixture('0.1.16-rc.1', 'next')
  mixed.peerDependencies['@deepseek-ai/dsh-agent'] = '^0.1.2-alpha.2'
  assert.throws(() => releaseMetadata(mixed), /peer range must be \*/)
})

test('checked-in candidate has consistent dependency and release metadata', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(releaseMetadata(pkg).dist_tag, pkg.publishConfig.tag)
})

test('a release can create its tag or reuse a tag at the verified commit', () => {
  const version = '0.1.29'
  const tag = `refs/tags/v${version}`
  const commit = 'a'.repeat(40)
  const other = 'b'.repeat(40)
  const annotation = 'c'.repeat(40)
  assertReleaseTagTarget(version, '', commit)
  assertReleaseTagTarget(version, `${commit}\t${tag}\n`, commit)
  assertReleaseTagTarget(version, `${annotation}\t${tag}\n${commit}\t${tag}^{}\n`, commit)
  assert.throws(() => assertReleaseTagTarget(version, `${other}\t${tag}\n`, commit), /points to/)
  assert.throws(() => assertReleaseTagTarget(version, `${annotation}\t${tag}\n${other}\t${tag}^{}\n`, commit), /points to/)
})
