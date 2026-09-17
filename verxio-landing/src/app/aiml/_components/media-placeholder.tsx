export function MediaPlaceholder({
  label,
  hint,
}: {
  label: string
  hint: string
}) {
  return (
    <div
      role="img"
      aria-label={`${label}. ${hint}`}
      className="flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">{hint}</p>
    </div>
  )
}
