'use client'

import { useState } from 'react'

import { AIML_PLACEHOLDERS } from '@/lib/aiml'

export function BeforeAfterVideo() {
  const [playing, setPlaying] = useState(false)
  const { videoId, videoTitle } = AIML_PLACEHOLDERS.beforeAfter

  return (
    <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-black shadow-sm">
      <div className="relative aspect-video min-h-56 w-full">
        {playing ? (
          <iframe
            title={videoTitle}
            src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play video: ${videoTitle}`}
            className="group absolute inset-0 block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 bg-black/30 transition-colors group-hover:bg-black/40" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="relative flex h-28 w-28 items-center justify-center sm:h-36 sm:w-36">
                <span className="aiml-play-ring absolute inset-0 rounded-full bg-red-600/35" aria-hidden />
                <span className="aiml-play-ring-delay absolute inset-0 rounded-full bg-red-600/25" aria-hidden />
                <span
                  className="aiml-play-pulse relative flex h-24 w-24 items-center justify-center rounded-full bg-[#ff0000] shadow-[0_10px_40px_rgba(255,0,0,0.55)] transition-transform group-hover:scale-105 sm:h-32 sm:w-32"
                  aria-hidden
                >
                  <svg viewBox="0 0 24 24" className="ml-1.5 h-12 w-12 fill-white sm:h-16 sm:w-16" aria-hidden>
                    <path d="M8 5.14v13.72L19.5 12 8 5.14z" />
                  </svg>
                </span>
              </span>
            </span>
          </button>
        )}
      </div>
    </figure>
  )
}
