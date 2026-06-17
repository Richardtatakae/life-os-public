'use client'

/**
 * ProblemsPanelV2 — visual rebuild of ProblemsPanel on the new design system.
 *
 * Data wiring is identical to ProblemsPanel.tsx (same tRPC queries + mutations,
 * same state machine). ONLY visuals change: Panel primitive, Button, Input, cn().
 *
 * Colour rule (non-negotiable, red-green safe):
 *   Problems accent  → amber  (var(--destructive), our amber token)
 *   Primary actions  → blue   (var(--primary))
 *   Danger / remove  → muted → foreground on hover (NOT red)
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc/client'
import { Panel } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function ProblemsPanelV2() {
  const [adding, setAdding] = useState(false)
  const [addText, setAddText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = useState('')

  const utils = trpc.useUtils()
  const problemsQuery = trpc.problem.list.useQuery()
  const problems = problemsQuery.data ?? []

  const areasQuery = trpc.area.list.useQuery()
  const areas = areasQuery.data ?? []

  const goalsQuery = trpc.goal.list.useQuery()
  const goals = goalsQuery.data ?? []

  const createProblem = trpc.problem.create.useMutation({
    onSuccess: () => {
      setAddText('')
      setAdding(false)
      void utils.problem.list.invalidate()
    },
  })
  const updateProblem = trpc.problem.update.useMutation({
    onSuccess: () => {
      setEditingId(null)
      setEditText('')
      void utils.problem.list.invalidate()
    },
  })
  const removeProblem = trpc.problem.remove.useMutation({
    onSettled: () => { void utils.problem.list.invalidate() },
  })
  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      void utils.task.tree.invalidate()
    },
  })

  function openAdd() { setAdding(true) }
  function submitAdd() {
    const t = addText.trim()
    if (!t) return
    createProblem.mutate({ text: t })
  }
  function cancelAdd() {
    setAdding(false)
    setAddText('')
  }

  function startEdit(id: string, text: string) {
    setEditingId(id)
    setEditText(text)
    setConvertingId(null)
  }
  function submitEdit(id: string) {
    const t = editText.trim()
    if (!t) return
    updateProblem.mutate({ id, text: t })
  }
  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  function openConvert(id: string) {
    setConvertingId((prev) => (prev === id ? null : id))
    setSelectedTarget('')
    setEditingId(null)
  }

  async function doConvert(problem: { id: string; text: string }) {
    if (!selectedTarget) return
    const [type, id] = selectedTarget.split(':')
    const payload =
      type === 'goal'
        ? { title: problem.text, goalId: id }
        : type === 'area'
        ? { title: problem.text, areaId: id }
        : { title: problem.text }

    await createTask.mutateAsync(payload)
    removeProblem.mutate({ id: problem.id })
    setConvertingId(null)
    setSelectedTarget('')
  }

  const activeGoals = goals.filter((g) => g.status === 'active')

  // ── Row shared classes ────────────────────────────────────────────────────
  const rowBase = cn(
    'flex items-center gap-2',
    'rounded-[calc(var(--radius)-4px)] px-2 py-1.5 text-sm',
    'hover:bg-secondary transition-colors',
  )

  return (
    <Panel className="box-drag-handle flex flex-col gap-0">
      {/* Header */}
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--destructive)]">
          Problems
        </h3>
        <span className="text-xs text-muted-foreground">({problems.length})</span>
      </div>

      {/* Empty state */}
      {problems.length === 0 && !adding && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          No problems logged — jot one down to convert it into a task later.
        </p>
      )}

      {/* Problem rows */}
      <div className="flex flex-col">
        {problems.map((p) => (
          <div key={p.id}>
            {editingId === p.id ? (
              /* Inline rename */
              <div
                className={rowBase}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    cancelEdit()
                  }
                }}
              >
                <Input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitEdit(p.id)
                    if (e.key === 'Escape') cancelEdit()
                  }}
                  className="h-7 flex-1 py-0 text-sm"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => submitEdit(p.id)}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  aria-label="Cancel rename"
                >
                  ✕
                </Button>
              </div>
            ) : (
              <div className={rowBase}>
                <span
                  className="flex-1 cursor-default select-none"
                  onDoubleClick={() => startEdit(p.id, p.text)}
                  title="Double-click to rename"
                >
                  {p.text}
                </span>
                {/* → task */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => openConvert(p.id)}
                  title="Convert to task"
                  aria-label="Convert to task"
                  className="text-xs"
                >
                  → task
                </Button>
                {/* remove ✕ */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removeProblem.mutate({ id: p.id })}
                  aria-label="Remove problem"
                  title="Remove"
                  className="text-muted-foreground hover:text-foreground px-1.5"
                >
                  ✕
                </Button>
              </div>
            )}

            {/* Convert-to-task picker */}
            {convertingId === p.id && (
              <div className="flex flex-wrap items-center gap-2 py-1 pl-6">
                <select
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                  className={cn(
                    'rounded-[calc(var(--radius)-4px)] border border-border',
                    'bg-background px-2 py-1.5 text-sm text-foreground',
                    'focus:outline-none focus:ring-2 focus:ring-ring/40',
                  )}
                >
                  <option value="">Choose destination…</option>
                  {areas.map((area) => {
                    const areaGoals = activeGoals.filter((g) => g.areaId === area.id)
                    return (
                      <optgroup key={area.id} label={area.name}>
                        {areaGoals.map((g) => (
                          <option key={g.id} value={`goal:${g.id}`}>
                            {g.title}
                          </option>
                        ))}
                        <option value={`area:${area.id}`}>
                          {area.name} (loose tasks)
                        </option>
                      </optgroup>
                    )
                  })}
                  <option value="none">No area / inbox</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={!selectedTarget || createTask.isPending}
                  onClick={() => doConvert(p)}
                >
                  {createTask.isPending ? '…' : 'Create task'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => { setConvertingId(null); setSelectedTarget('') }}
                  aria-label="Cancel convert"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add row */}
      <div
        className={cn('mt-2 flex items-center gap-2', adding ? '' : '')}
        onBlur={
          adding
            ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  cancelAdd()
                }
              }
            : undefined
        }
      >
        {adding ? (
          <>
            <Input
              autoFocus
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAdd()
                if (e.key === 'Escape') cancelAdd()
              }}
              placeholder="New problem…"
              className="h-7 flex-1 py-0 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={submitAdd}
              disabled={createProblem.isPending}
            >
              Add
            </Button>
          </>
        ) : (
          <>
            <Input
              placeholder="New problem…"
              onFocus={openAdd}
              readOnly
              className="h-7 flex-1 cursor-pointer py-0 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={openAdd}
            >
              Add
            </Button>
          </>
        )}
      </div>
    </Panel>
  )
}
