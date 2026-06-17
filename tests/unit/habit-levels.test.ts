/**
 * habitLevels pure-logic tests — the level ladder layered on the consistency
 * score. No DB: pure functions tested in isolation. Covers band edges, the
 * re-basing progress math, and the two summit tiers (Legend, Mythical).
 */

import { describe, it, expect } from 'vitest'
import { LEVELS, CAP, THRESHOLDS, levelFor, summitStyle } from '@/lib/habitLevels'

describe('LEVELS / THRESHOLDS shape', () => {
  it('has 8 rungs, 0-indexed', () => {
    expect(LEVELS).toHaveLength(8)
    expect(LEVELS.map((l) => l.level)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
  it('exposes the locked thresholds', () => {
    expect(THRESHOLDS).toEqual([0, 10, 25, 45, 70, 90, 99, 99.99])
  })
  it('Legend (L6) is the gold tier; Mythical (L7) is the summit, cap 100', () => {
    expect(LEVELS[6].isLegend).toBe(true)
    expect(LEVELS[7].isMythical).toBe(true)
    expect(LEVELS.slice(0, 6).some((l) => l.isLegend || l.isMythical)).toBe(false)
    expect(LEVELS[7].isLegend).toBeUndefined()
    expect(LEVELS[6].isMythical).toBeUndefined()
    expect(CAP).toBe(100)
  })
})

describe('summitStyle — only the two summit tiers get accent visuals', () => {
  it('returns null for ordinary rungs', () => {
    expect(summitStyle(levelFor(50))).toBeNull()
    expect(summitStyle(levelFor(95))).toBeNull()
  })
  it('Legend → gold ✦, Mythical → blue ✧, and they differ', () => {
    const legend = summitStyle(levelFor(99.0))
    const mythic = summitStyle(levelFor(99.99))
    expect(legend?.star).toBe('✦')
    expect(mythic?.star).toBe('✧')
    expect(legend?.accent).not.toBe(mythic?.accent)
    expect(legend?.fillClass).toBe('habit-legend-fill')
    expect(mythic?.fillClass).toBe('habit-mythic-fill')
  })
})

describe('levelFor — band assignment at the edges', () => {
  it('0 → Starting', () => expect(levelFor(0).level).toBe(0))
  it('9.99 stays Starting (band is 0–9.99)', () => expect(levelFor(9.99).level).toBe(0))
  it('10 crosses into Spark', () => expect(levelFor(10).level).toBe(1))
  it('24.99 stays Spark', () => expect(levelFor(24.99).level).toBe(1))
  it('25 crosses into Building', () => expect(levelFor(25).level).toBe(2))
  it('44.99 / 45 edge → Building / Consistent', () => {
    expect(levelFor(44.99).level).toBe(2)
    expect(levelFor(45).level).toBe(3)
  })
  it('69.99 / 70 edge → Consistent / Strong', () => {
    expect(levelFor(69.99).level).toBe(3)
    expect(levelFor(70).level).toBe(4)
  })
  it('89.99 / 90 edge → Strong / Elite', () => {
    expect(levelFor(89.99).level).toBe(4)
    expect(levelFor(90).level).toBe(5)
  })
  it('98.99 stays Elite, 99.0 crosses into Legend', () => {
    expect(levelFor(98.99).level).toBe(5)
    expect(levelFor(99.0).level).toBe(6)
    expect(levelFor(99.0).isLegend).toBe(true)
  })
  it('99.98 stays Legend, 99.99 crosses into Mythical', () => {
    expect(levelFor(99.98).level).toBe(6)
    expect(levelFor(99.98).isLegend).toBe(true)
    expect(levelFor(99.99).level).toBe(7)
    expect(levelFor(99.99).isMythical).toBe(true)
    expect(levelFor(99.99).isLegend).toBe(false)
  })
})

describe('levelFor — names and ceilings', () => {
  it('reports the right name and ceil per band', () => {
    expect(levelFor(82.1).name).toBe('Strong')
    expect(levelFor(82.1).ceil).toBe(90)
    expect(levelFor(31.2).name).toBe('Building')
    expect(levelFor(31.2).ceil).toBe(45)
  })
  it('Legend ceil is the Mythical floor 99.99', () => {
    expect(levelFor(99.5).ceil).toBe(99.99)
  })
  it('Mythical ceil is the hard cap 100', () => {
    expect(levelFor(99.99).ceil).toBe(CAP)
  })
})

describe('levelFor — re-basing progress within the band', () => {
  it('82.10 in Strong (70–90) ≈ 60.5% full', () => {
    expect(levelFor(82.1).progress).toBeCloseTo(0.605, 3)
  })
  it('31.20 in Building (25–45) ≈ 31% full', () => {
    expect(levelFor(31.2).progress).toBeCloseTo(0.31, 3)
  })
  it('a score sitting on a floor reads near-empty', () => {
    expect(levelFor(70).progress).toBe(0)
  })
  it('a score just under the next floor reads near-full', () => {
    expect(levelFor(89.99).progress).toBeCloseTo(0.9995, 3)
  })
})

describe('levelFor — the summit tiers stretch the top decimals', () => {
  it('99.0 (Legend floor) is an empty Legend bar', () => {
    expect(levelFor(99.0).progress).toBe(0)
  })
  it('99.50 fills ~half of the 99.0–99.99 Legend band', () => {
    expect(levelFor(99.5).progress).toBeCloseTo(0.505, 3)
  })
  it('99.99 (Mythical floor) is an empty Mythical bar', () => {
    expect(levelFor(99.99).level).toBe(7)
    expect(levelFor(99.99).progress).toBe(0)
  })
  it('99.995 fills ~half of the 99.99–100 Mythical band', () => {
    expect(levelFor(99.995).progress).toBeCloseTo(0.5, 3)
  })
  it('100 (cap) fills the Mythical bar', () => {
    expect(levelFor(100).level).toBe(7)
    expect(levelFor(100).progress).toBe(1)
  })
  it('clamps a score above the cap to a full bar', () => {
    expect(levelFor(100.5).progress).toBe(1)
  })
})

describe('levelFor — clamps out-of-range scores', () => {
  it('negative score clamps to Level 0, empty bar', () => {
    expect(levelFor(-5).level).toBe(0)
    expect(levelFor(-5).progress).toBe(0)
  })
})
