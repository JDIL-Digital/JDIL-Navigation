import { STATUS_COLORS, PO_STATUSES } from '../../utils/constants'
import { calcReverseLogisticsStatus, getRLDisplayStatus, rlStageList } from '../../utils/helpers'

const RL_TERMINAL = new Set(['Delivered to Rig', 'Delivered to Vendor'])

// Reverse-logistics status pill: colour from pipeline stage, text enriched with location.
export function RLStatusPill({ job }) {
  const stage = calcReverseLogisticsStatus(job)
  const label = getRLDisplayStatus(job)
  const color = stage === 'Failed'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    : RL_TERMINAL.has(stage)
      ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
  return <span className={`status-pill ${color}`}>{label}</span>
}

// Progress dots through the RL stage list for the job's type.
export function RLPipelineDots({ job }) {
  const stages = rlStageList(job.job_type)
  const stage  = calcReverseLogisticsStatus(job)
  const idx    = stage === 'Failed' ? -1 : stages.indexOf(stage)
  return (
    <div className="flex items-center gap-0.5">
      {stages.map((_, i) => (
        <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
          i < idx ? 'bg-jdil-green' : i === idx ? 'bg-jdil-green ring-2 ring-jdil-green ring-offset-1 dark:ring-offset-gray-900' : 'bg-gray-300 dark:bg-gray-600'
        }`} />
      ))}
    </div>
  )
}

export function StatusPill({ status, label }) {
  // Colour comes from the pipeline `status`; `label` (if given) overrides the
  // visible text — e.g. "In Transit to Nhava" while still coloured as transit.
  return (
    <span className={`status-pill ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {label || status}
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
