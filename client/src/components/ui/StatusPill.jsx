import { STATUS_COLORS, PO_STATUSES } from '../../utils/constants'

export function StatusPill({ status }) {
  return (
    <span className={`status-pill ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

export function PipelineDots({ status }) {
  const idx = PO_STATUSES.indexOf(status)
  return (
    <div className="flex items-center gap-0.5">
      {PO_STATUSES.map((_, i) => (
        <div
          key={i}
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            i < idx ? 'bg-jdil-green' : i === idx ? 'bg-jdil-green ring-2 ring-jdil-green ring-offset-1 dark:ring-offset-gray-900' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        />
      ))}
    </div>
  )
}
