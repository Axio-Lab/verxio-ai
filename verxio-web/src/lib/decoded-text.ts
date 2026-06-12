import { useEffect, useState } from 'react'

// Hero decode uses the same ascii map as the gateway connecting overlay.
const ASCII_GLYPHS = [...'/\\|-_=+<>~:*']
const pickAscii = () => ASCII_GLYPHS[(Math.random() * ASCII_GLYPHS.length) | 0]

// How many trailing characters of each word scramble during decode-in.
const DECODE_TAIL = 4

/**
 * Left-to-right decode reveal: each word keeps its prefix static while the tail
 * churns through ascii noise before settling on the real text. Matches the
 * onboarding "connected" label and gateway connecting overlay motif.
 */
export function useDecoded(text: string): string {
  const [out, setOut] = useState(text)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setOut(text)

      return
    }

    const chars = [...text]
    const scrambleable = chars.map(() => false)

    for (let i = 0; i < chars.length; ) {
      if (!/[a-z0-9]/i.test(chars[i])) {
        i += 1

        continue
      }

      let j = i

      while (j < chars.length && /[a-z0-9]/i.test(chars[j])) {
        j += 1
      }

      for (let k = Math.max(i, j - DECODE_TAIL); k < j; k += 1) {
        scrambleable[k] = true
      }

      i = j
    }

    const tailIndices = chars.map((_, idx) => idx).filter(idx => scrambleable[idx])
    let resolved = 0

    const id = window.setInterval(() => {
      resolved += 0.5
      const settled = new Set(tailIndices.slice(0, Math.floor(resolved)))

      setOut(chars.map((ch, idx) => (scrambleable[idx] && !settled.has(idx) ? pickAscii() : ch)).join(''))

      if (Math.floor(resolved) >= tailIndices.length) {
        window.clearInterval(id)
      }
    }, 45)

    return () => window.clearInterval(id)
  }, [text])

  return out
}
