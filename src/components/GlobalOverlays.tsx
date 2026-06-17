'use client'

/**
 * GlobalOverlays.tsx — Client Component wrapper that mounts the global
 * overlays/modals once in the root layout.
 *
 * These components use hooks (tRPC, Zustand) and are therefore Client
 * Components — they cannot be imported directly into a Server Component
 * layout. This wrapper is the bridge.
 *
 * Mounted as a sibling of {children} inside <TrpcProvider> in layout.tsx.
 */

import { PromptModal } from '@/components/shared/PromptModal'
import { FocusOverlay } from '@/components/focus/FocusOverlay'
import { BreakBox } from '@/components/focus/BreakBox'
import { LaunchBox } from '@/components/focus/LaunchBox'
import { VowBar } from '@/components/vow/VowBar'
import { VowSplash } from '@/components/vow/VowSplash'
// VowActivationModal is being created by a sibling agent (Wave 2 Task 4).
// Import it here so the full overlay stack is wired; TS will resolve it at
// wave-end when the sibling file lands. Do NOT create it here.
import { VowActivationModal } from '@/components/vow/VowActivationModal'
import { VowExitFlow } from '@/components/vow/VowExitFlow'

export function GlobalOverlays() {
  return (
    <>
      {/* Vow Mode chrome — always-visible when a vow is active */}
      <VowBar />
      <VowSplash />
      <VowActivationModal />
      <VowExitFlow />

      {/* Standard overlays */}
      <PromptModal />
      <FocusOverlay />
      <BreakBox />
      <LaunchBox />
    </>
  )
}
