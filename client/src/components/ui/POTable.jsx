import { calcStatus, daysElapsed, formatDate } from '../../utils/helpers'
import { OVERDUE_DAYS } from '../../utils/constants'
import { StatusPill, PipelineDots } from './StatusPill'

export default function POTable({ orders, onRowClick, visibleColumns = 'purchase' }) {
  return (
    <div className="overflow-x-auto -mx-0">
      <table className="w-full min-w-[320px]">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-800">
            <th className="table-header rounded-tl-lg">PO / MR</th>
            <th className="table-header">Rig</th>
            {/* Hide on mobile */}
            <th className="table-header hidden sm:table-cell">Vendor</th>
            <th className="table-header hidden md:table-cell">Material</th>
            <th className="table-header">Status</th>
            <th className="table-header hidden lg:table-cell">Pipeline</th>
            {visibleColumns === 'logistics' && (
              <>
                <th className="table-header hidden sm:table-cell">Dispatch Date</th>
                <th className="table-header hidden md:table-cell">JDIL Location</th>
              </>
            )}
            {visibleColumns === 'rig' && (
              <>
                <th className="table-header hidden sm:table-cell">In Transit</th>
                <th className="table-header hidden sm:table-cell">Delivered</th>
              </>
            )}
            {visibleColumns === 'purchase' && (
              <>
                <th className="table-header hidden sm:table-cell">Promise Date</th>
                <th className="table-header">Days</th>
              </>
            )}
            <th className="table-header rounded-tr-lg hidden sm:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {orders.length === 0 ? (
            <tr>
              <td colSpan={10} className="text-center py-12 text-sm text-gray-400 dark:text-gray-500">
                No purchase orders found
              </td>
            </tr>
          ) : (
            orders.map(po => {
              const status = calcStatus(po)
              const days   = daysElapsed(po.po_date)
              const isStale = days > OVERDUE_DAYS && status !== 'Delivered to Rig'
              return (
                <tr
                  key={po.id}
                  onClick={() => onRowClick?.(po)}
                  className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isStale ? 'bg-red-50/30 dark:bg-red-900/5' : ''}`}
                >
                  {/* PO / MR — always visible */}
                  <td className="table-cell">
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-xs">{po.po_number}</p>
                    <p className="text-gray-400 dark:text-gray-500 text-xs">{po.mr_number}</p>
                  </td>
                  {/* Rig — always visible */}
                  <td className="table-cell text-xs">{po.rig_name}</td>
                  {/* Vendor — hidden on mobile */}
                  <td className="table-cell hidden sm:table-cell">
                    <span className="text-xs truncate max-w-[120px] block">{po.vendor_name}</span>
                  </td>
                  {/* Material — hidden on mobile+tablet */}
                  <td className="table-cell hidden md:table-cell">
                    <span className="text-xs truncate max-w-[140px] block">{po.material_description}</span>
                  </td>
                  {/* Status — always visible */}
                  <td className="table-cell">
                    <StatusPill status={status} />
                  </td>
                  {/* Pipeline dots — hidden on mobile */}
                  <td className="table-cell hidden lg:table-cell">
                    <PipelineDots status={status} />
                  </td>

                  {visibleColumns === 'logistics' && (
                    <>
                      <td className="table-cell text-xs hidden sm:table-cell">{formatDate(po.dispatch_date)}</td>
                      <td className="table-cell text-xs hidden md:table-cell">{po.jdil_location || '—'}</td>
                    </>
                  )}
                  {visibleColumns === 'rig' && (
                    <>
                      <td className="table-cell text-xs hidden sm:table-cell">{formatDate(po.in_transit_rig_date)}</td>
                      <td className="table-cell text-xs hidden sm:table-cell">{formatDate(po.delivered_to_rig_date)}</td>
                    </>
                  )}
                  {visibleColumns === 'purchase' && (
                    <>
                      <td className="table-cell text-xs hidden sm:table-cell">{formatDate(po.promised_ready_date)}</td>
                      <td className="table-cell">
                        <span className={`text-xs font-semibold ${isStale ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
                          {days}d {isStale ? '⚠' : ''}
                        </span>
                      </td>
                    </>
                  )}
                  {/* Updated — hidden on mobile */}
                  <td className="table-cell text-xs text-gray-400 dark:text-gray-500 hidden sm:table-cell">
                    {po.updated_at ? formatDate(po.updated_at.split('T')[0]) : '—'}
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
