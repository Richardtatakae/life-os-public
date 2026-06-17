/**
 * routineChecklist pure-logic tests — the "all boxes ticked → habit done" rule
 * that drives the routine-attached habit auto-tick. No DB: pure function tested
 * in isolation. Covers the empty routine, all-done, one-missing, false/absent
 * checks, and stale extra checks that don't belong to the routine.
 */

import { describe, it, expect } from 'vitest'
import { checklistComplete, anyRoutineComplete } from '@/lib/routineChecklist'

describe('checklistComplete', () => {
  it('empty routine (no sources) is never complete', () => {
    expect(checklistComplete([], new Map())).toBe(false)
  })

  it('empty routine stays false even if stray checks exist', () => {
    expect(checklistComplete([], new Map([['ghost', true]]))).toBe(false)
  })

  it('single source, checked → complete', () => {
    expect(checklistComplete(['a'], new Map([['a', true]]))).toBe(true)
  })

  it('single source, unchecked (absent) → incomplete', () => {
    expect(checklistComplete(['a'], new Map())).toBe(false)
  })

  it('single source, explicitly done=false → incomplete', () => {
    expect(checklistComplete(['a'], new Map([['a', false]]))).toBe(false)
  })

  it('all sources checked → complete', () => {
    const checks = new Map([['a', true], ['b', true], ['c', true]])
    expect(checklistComplete(['a', 'b', 'c'], checks)).toBe(true)
  })

  it('one of many missing → incomplete', () => {
    const checks = new Map([['a', true], ['b', true]])
    expect(checklistComplete(['a', 'b', 'c'], checks)).toBe(false)
  })

  it('one of many explicitly false → incomplete', () => {
    const checks = new Map([['a', true], ['b', false], ['c', true]])
    expect(checklistComplete(['a', 'b', 'c'], checks)).toBe(false)
  })

  it('mixes steps and conditions — both must be done', () => {
    const checks = new Map([['step1', true], ['cond1', true]])
    expect(checklistComplete(['step1', 'cond1'], checks)).toBe(true)
  })

  it('mixes steps and conditions — condition unchecked blocks it', () => {
    const checks = new Map([['step1', true], ['cond1', false]])
    expect(checklistComplete(['step1', 'cond1'], checks)).toBe(false)
  })

  it('ignores stale checks for ids no longer in the routine', () => {
    // 'removed' was checked but is no longer a source; the real sources are done.
    const checks = new Map([['a', true], ['b', true], ['removed', true]])
    expect(checklistComplete(['a', 'b'], checks)).toBe(true)
  })

  it('a once-checked, since-removed source does not satisfy a still-missing one', () => {
    const checks = new Map([['a', true], ['removed', true]])
    expect(checklistComplete(['a', 'b'], checks)).toBe(false)
  })

  it('all explicitly false → incomplete', () => {
    const checks = new Map([['a', false], ['b', false]])
    expect(checklistComplete(['a', 'b'], checks)).toBe(false)
  })
})

describe('anyRoutineComplete (OR logic across multiple attached routines)', () => {
  it('no routines attached → false', () => {
    expect(anyRoutineComplete([], new Map())).toBe(false)
  })

  it('the only routine fully done → true', () => {
    const checks = new Map([['a', true], ['b', true]])
    expect(anyRoutineComplete([{ sourceIds: ['a', 'b'] }], checks)).toBe(true)
  })

  it('one of two routines fully done → true (OR)', () => {
    // Solo (s1,s2) all done; Social (x1,x2) not — habit still ticks.
    const checks = new Map([['s1', true], ['s2', true], ['x1', true], ['x2', false]])
    const routines = [{ sourceIds: ['s1', 's2'] }, { sourceIds: ['x1', 'x2'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(true)
  })

  it('the OTHER routine fully done → true (order-independent)', () => {
    const checks = new Map([['s1', false], ['x1', true], ['x2', true]])
    const routines = [{ sourceIds: ['s1', 's2'] }, { sourceIds: ['x1', 'x2'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(true)
  })

  it('both routines fully done → true', () => {
    const checks = new Map([['s1', true], ['x1', true]])
    const routines = [{ sourceIds: ['s1'] }, { sourceIds: ['x1'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(true)
  })

  it('neither routine complete → false', () => {
    const checks = new Map([['s1', true], ['s2', false], ['x1', false]])
    const routines = [{ sourceIds: ['s1', 's2'] }, { sourceIds: ['x1', 'x2'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(false)
  })

  it('an empty routine never satisfies on its own', () => {
    const checks = new Map([['x1', false]])
    const routines = [{ sourceIds: [] }, { sourceIds: ['x1'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(false)
  })

  it('checks are shared by id — a box in one routine does not leak to satisfy the other', () => {
    // 'shared' is a source in both; ticking it completes routine B (only that id)
    // but routine A still needs 'a2'.
    const checks = new Map([['shared', true], ['a2', false]])
    const routines = [{ sourceIds: ['shared', 'a2'] }, { sourceIds: ['shared'] }]
    expect(anyRoutineComplete(routines, checks)).toBe(true) // routine B is complete
  })
})
