/** Friendly worked-time total like "1h 25m" / "40m" / "0m". */
export function formatWorked(ms: number): string {
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
