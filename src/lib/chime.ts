'use client'

/**
 * chime.ts — a tiny self-contained timer-end sound.
 *
 * Uses the Web Audio API to synthesise a short, gentle two-note "ding-ding"
 * so there's no binary audio asset to ship. One shared AudioContext lives as a
 * module singleton.
 *
 * Browsers block audio until a user gesture, so `primeChime()` should be called
 * from a click handler (e.g. starting a focus interval) to create/resume the
 * context ahead of time; by the time a timer actually ends, playback is allowed.
 */

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

/** Create/resume the audio context from a user gesture so later chimes can play. */
export function primeChime(): void {
  const audio = getCtx()
  if (audio && audio.state === 'suspended') void audio.resume()
}

/** Play a soft rising two-note chime to signal a timer ending. */
export function playChime(): void {
  const audio = getCtx()
  if (!audio) return
  if (audio.state === 'suspended') void audio.resume()

  const now = audio.currentTime
  const notes = [880, 1174.66] // A5 → D6
  notes.forEach((freq, i) => {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const start = now + i * 0.18
    const dur = 0.35
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.25, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
    osc.connect(gain).connect(audio.destination)
    osc.start(start)
    osc.stop(start + dur)
  })
}
