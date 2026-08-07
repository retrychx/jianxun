import { useState, useEffect } from 'react'
import { Sun, Moon, Feather } from 'lucide-react'

export type Theme = 'light' | 'dark' | 'retro'
export const THEMES: Theme[] = ['light', 'dark', 'retro']
export const THEME_META: Record<Theme, { label: string; Icon: typeof Sun }> = {
  light: { label: '浅色', Icon: Sun },
  dark: { label: '深色', Icon: Moon },
  retro: { label: '复古', Icon: Feather },
}

function getInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'retro'
  const stored = localStorage.getItem('theme') as Theme | null
  if (stored && THEMES.includes(stored)) return stored
  return 'retro'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const colors: Record<Theme, string> = { light: '#fafafa', dark: '#111111', retro: '#f5f0eb' }
      meta.setAttribute('content', colors[theme])
    }
  }, [theme])

  return { theme, setTheme }
}
