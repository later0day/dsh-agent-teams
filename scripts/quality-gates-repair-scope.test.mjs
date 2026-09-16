#!/usr/bin/env node
/**
 * Regression tests for auto-repair inScope derivation (planQualityFollowUp).
 *
 * Incident: a review finding observed the mismatch in `data/sample.txt` but
 * its requiredFix said "edit README.md". The generated repair round declared
 * inScope from `finding.file` alone, so its acceptance ("edit README.md")
 * named a path the scope forbade — no honest completion existed and the
 * repair dead-locked (worker blocked, downstream review permanently pending).
 *
 * Second incident (issue #173): the repair inherits the source task's
 * `outOfScope` verbatim, and `classifyChangedPath` lets `outOfScope` win
 * (`tdd.scope.out-of-scope-wins`). A derived candidate covered by an inherited
 * directory pattern is therefore unregistrable, so the derivation skips it
 * instead of widening the scope with an entry the gate always rejects.
 *
 * Run: node --test scripts/quality-gates-repair-scope.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathMatchesScope, planQualityFollowUp, repairScopeFromFindings } from '../lib/quality-gates.js'

function finding(extra = {}) {
  return { id: 'F1', severity: 'medium', problem: 'problem', requiredFix: 'fix it', ...extra }
}

function member(name, role) {
  return { id: `member-${name}`, name, role, joinedAt: 0, status: 'idle' }
}

function teamWithSource(extra = {}) {
  return {
    name: 't', id: 't', description: '', captainSessionId: 'captain',
    createdAt: 0, taskSeq: 1,
    members: [member('implementer', 'implementer'), member('reviewer', 'reviewer')],
    tasks: [{
      id: 't1', subject: 'impl', status: 'completed', dependencies: [],
      createdAt: 0, updatedAt: 0, attempt: 1, kind: 'implementation',
      assignee: 'implementer',
      inScope: ['src/'], acceptance: ['done'], verify: ['pnpm test'],
      ...extra,
    }],
  }
}

function failedReview(extra = {}) {
  return {
    id: 't2', subject: 'review', status: 'failed', dependencies: ['t1'],
    createdAt: 0, updatedAt: 0, attempt: 1, kind: 'review', round: 1,
    assignee: 'reviewer', verdict: 'needs_revision', reviewedTaskId: 't1',
    objective: 'Review', acceptance: ['no blockers'],
    findings: [finding()],
    ...extra,
  }
}

test('repair scope includes the fix target named in requiredFix, not just the observed file', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'data/sample.txt', requiredFix: 'change README.md:5 to "2 lines / 5 words"' })],
    ['data/sample.txt'],
  )
  assert.ok(scope.includes('README.md'), `README.md missing from ${JSON.stringify(scope)}`)
  assert.ok(scope.includes('data/sample.txt'), `observed file missing from ${JSON.stringify(scope)}`)
})

test('repair scope drops absolute paths that can never match workspace-relative patterns', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'F:\\team\\data\\sample.txt', requiredFix: 'update README.md sample reference to 5 words' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['README.md'])
})

test('repair scope falls back to the source inScope when findings name nothing legal', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'reinstall the tool globally and retry' })],
    ['src/'],
  )
  assert.deepEqual(scope, ['src/'])
})

test('line-number suffixes are stripped from derived paths', () => {
  const scope = repairScopeFromFindings(
    [finding({ requiredFix: 'rewrite docs/guide.md:42 to match the new flow' })],
    undefined,
  )
  assert.deepEqual(scope, ['docs/guide.md'])
})

test('end-to-end: generated repair round is satisfiable for the incident shape', () => {
  const closed = failedReview({
    findings: [finding({
      file: 'data/sample.txt',
      requiredFix: 'A (recommended) change README.md to "2 lines / 5 words"; do not modify wc.js',
    })],
  })
  const result = planQualityFollowUp(teamWithSource(), closed)
  const repair = result.created.find((item) => item.kind === 'repair')
  assert.ok(repair, 'repair round must be generated')
  assert.ok(repair.inScope.includes('README.md'), `README.md missing from ${JSON.stringify(repair.inScope)}`)
  assert.ok(
    repair.acceptance.every((criterion) => criterion.length > 0),
    'acceptance must stay non-empty',
  )
})

test('a candidate covered by the inherited outOfScope is not declared', () => {
  const scope = repairScopeFromFindings(
    [finding({
      file: 'data/sample.txt',
      requiredFix: 'edit deploy/compose/postfix/master.cf.inc and README.md',
    })],
    undefined,
    ['deploy/compose/postfix/'],
  )
  assert.ok(
    !scope.includes('deploy/compose/postfix/master.cf.inc'),
    `covered path must be skipped, got ${JSON.stringify(scope)}`,
  )
  assert.ok(scope.includes('README.md'))
  assert.ok(scope.includes('data/sample.txt'))
})

test('fallback survives when the inherited outOfScope covers every candidate', () => {
  const scope = repairScopeFromFindings(
    [finding({ file: 'deploy/only.txt', requiredFix: 'fix deploy/only.txt' })],
    ['src/'],
    ['deploy/'],
  )
  assert.deepEqual(scope, ['src/'])
})

test('end-to-end: generated repair declares no path its inherited outOfScope forbids', () => {
  const closed = failedReview({
    findings: [finding({
      file: 'deploy/compose/postfix/master.cf.inc',
      requiredFix: 'edit deploy/compose/postfix/master.cf.inc and docs/guide.md',
    })],
  })
  const result = planQualityFollowUp(teamWithSource({ outOfScope: ['deploy/compose/postfix/'] }), closed)
  const repair = result.created.find((item) => item.kind === 'repair')
  assert.ok(repair, 'repair round must be generated')
  assert.ok(repair.inScope.includes('docs/guide.md'), `docs/guide.md missing from ${JSON.stringify(repair.inScope)}`)
  const forbidden = repair.inScope.filter((entry) => pathMatchesScope(entry, 'deploy/compose/postfix/'))
  assert.deepEqual(forbidden, [], 'no declared path may be covered by the inherited outOfScope')
})
