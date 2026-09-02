import { ImageIcon } from 'lucide-react'

export function ImagePlaceholder({
  label,
  idea,
  tall = false,
}: {
  label: string
  idea: string
  tall?: boolean
}) {
  return (
    <figure
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 text-center ${
        tall ? 'min-h-72 py-12' : 'min-h-56 py-10'
      }`}
    >
      <ImageIcon className="h-8 w-8 text-gray-400" aria-hidden />
      <figcaption className="mt-3 text-base font-semibold text-gray-800">{label}</figcaption>
      <p className="mt-2 max-w-lg text-base leading-relaxed text-gray-500">{idea}</p>
    </figure>
  )
}
