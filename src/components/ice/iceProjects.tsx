'use client'

/**
 * iceProjects — the registry of "projects on ice": work you've parked but want
 * one click away. Each entry renders as a square in the Projects-on-Ice tab and,
 * when opened, lays out all of that project's elements on its own BoxBoard
 * (independent saved layout per project via `storageKey`).
 *
 * To park another project here later, add an entry: give it an id, a title, a
 * card icon/accent, its own storageKey, the panes (widgets) and a defaultLayout.
 */

import type { ReactNode } from 'react'
import type { Layout } from 'react-grid-layout'
import type { BoxPane } from '@/components/shared/BoxBoard'


export interface IceProject {
  /** Stable id (used as the open/route key). */
  id: string
  /** Card title. */
  title: string
  /** One-line description shown on the card. */
  blurb: string
  /** CSS colour (a palette variable) used for the card's accent. */
  accent: string
  /** Large glyph shown on the project square. */
  icon: ReactNode
  /** AppSetting key this project's board layout persists under (unique). */
  storageKey: string
  /** The project's elements. */
  panes: BoxPane[]
  /** Initial placement of those elements on a 12-column board. */
  defaultLayout: Layout
}


export const ICE_PROJECTS: IceProject[] = [
]
