'use client'

/**
 * DiamondCheckbox.tsx — 24×24 px rotated square with neon border.
 *
 * Checked state: filled with the chosen accent colour + glow.
 * Unchecked state: border only.
 *
 * Uses inline styles for the glow effect (Tailwind can't generate arbitrary
 * box-shadow values at build time).  All other styling is Tailwind.
 */

import React from 'react'

export type DiamondColor = 'emerald' | 'amber' | 'red'

interface DiamondCheckboxProps {
  checked: boolean
  onChange: () => void
  size?: number
  color?: DiamondColor
  disabled?: boolean
  'aria-label'?: string
}

const colorMap: Record<DiamondColor, { border: string; bg: string; glow: string }> = {
  emerald: {
    border: 'var(--color-emerald)',
    bg: 'var(--color-emerald)',
    glow: '0 0 8px 2px rgba(16, 185, 129, 0.6)',
  },
  amber: {
    border: 'var(--color-amber)',
    bg: 'var(--color-amber)',
    glow: '0 0 8px 2px rgba(245, 158, 11, 0.6)',
  },
  red: {
    border: 'var(--color-red)',
    bg: 'var(--color-red)',
    glow: '0 0 8px 2px rgba(239, 68, 68, 0.6)',
  },
}

export function DiamondCheckbox({
  checked,
  onChange,
  size = 24,
  color = 'emerald',
  disabled = false,
  'aria-label': ariaLabel,
}: DiamondCheckboxProps) {
  const { border, bg, glow } = colorMap[color]
  const half = size / 2

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    transform: 'rotate(45deg)',
    border: `2px solid ${border}`,
    backgroundColor: checked ? bg : 'transparent',
    boxShadow: checked ? glow : 'none',
    cursor: disabled ? 'default' : 'pointer',
    borderRadius: 3,
    flexShrink: 0,
    transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel ?? (checked ? 'Uncheck habit' : 'Check habit')}
      disabled={disabled}
      onClick={disabled ? undefined : onChange}
      style={{
        background: 'none',
        border: 'none',
        padding: half / 2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <div style={containerStyle} />
    </button>
  )
}
