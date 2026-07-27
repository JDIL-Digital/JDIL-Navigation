import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup } from 'react-leaflet'
import { RIG_COORDINATES, HUB_COORDINATES } from '../../utils/constants'
import { calcStatus } from '../../utils/helpers'
import { useTheme } from '../../context/ThemeContext'

export default function MaterialMap({ poOrders = [] }) {
  const { dark } = useTheme()

  // Count open (non-delivered) POs per rig
  const rigCounts = {}
  poOrders.forEach(po => {
    if (!po.rig_name) return
    const isOpen = calcStatus(po) !== 'Delivered to Rig'
    if (!rigCounts[po.rig_name]) rigCounts[po.rig_name] = { open: 0, total: 0 }
    rigCounts[po.rig_name].total++
    if (isOpen) rigCounts[po.rig_name].open++
  })

  const hubCounts = { BKC: 0, Taloja: 0, Nagothane: 0, Nhava: 0 }
  poOrders.forEach(po => {
    const status = calcStatus(po)
    if (status === 'Delivered to Rig' || status === 'In Transit to Rig') return
    if (po.dc_number_bkc)       hubCounts.BKC++
    if (po.dc_number_taloja)    hubCounts.Taloja++
    if (po.dc_number_nagothane) hubCounts.Nagothane++
    if (po.dc_number_nhava)     hubCounts.Nhava++
  })

  const tileUrl = dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  const tileAttrib = dark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

  return (
    <MapContainer
      center={[20.2, 74.5]}
      zoom={6}
      style={{ height: '300px', width: '100%', borderRadius: '0.5rem' }}
      scrollWheelZoom={false}
    >
      <TileLayer attribution={tileAttrib} url={tileUrl} />

      {/* Rig markers — blue */}
      {Object.entries(RIG_COORDINATES).map(([name, coords]) => {
        const counts = rigCounts[name]
        const open   = counts?.open  ?? 0
        const total  = counts?.total ?? 0
        const radius = open > 0 ? Math.min(7 + open * 1.5, 18) : 6
        return (
          <CircleMarker key={name} center={coords} radius={radius}
            pathOptions={{ color: '#1d4ed8', fillColor: open > 0 ? '#3b82f6' : '#93c5fd', fillOpacity: 0.85, weight: 2 }}>
            <Tooltip direction="top" offset={[0, -radius]} opacity={0.9}>
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <strong>{name}</strong>
                {open > 0 ? <><br />{open} open PO{open !== 1 ? 's' : ''}<br />{total} total</> : <><br />No open POs</>}
              </div>
            </Tooltip>
            <Popup>
              <div style={{ fontSize: 12, minWidth: 120 }}>
                <strong style={{ fontSize: 13 }}>{name}</strong>
                <hr style={{ margin: '4px 0', borderColor: '#e5e7eb' }} />
                <div>Open POs: <strong>{open}</strong></div>
                <div>Total POs: <strong>{total}</strong></div>
                {total > 0 && <div>Delivered: <strong>{total - open}</strong></div>}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Hub markers — orange */}
      {Object.entries(HUB_COORDINATES).map(([name, coords]) => {
        const count  = hubCounts[name] ?? 0
        const radius = count > 0 ? Math.min(9 + count, 18) : 8
        return (
          <CircleMarker key={name} center={coords} radius={radius}
            pathOptions={{ color: '#c2410c', fillColor: '#f97316', fillOpacity: 0.85, weight: 2 }}>
            <Tooltip direction="top" offset={[0, -radius]} opacity={0.9}>
              <div style={{ fontSize: 12, lineHeight: 1.4 }}>
                <strong>{name} Hub</strong>
                {count > 0 ? <><br />{count} PO{count !== 1 ? 's' : ''} with DC number</> : <><br />No POs with DC number</>}
              </div>
            </Tooltip>
            <Popup>
              <div style={{ fontSize: 12, minWidth: 120 }}>
                <strong style={{ fontSize: 13 }}>{name} Hub</strong>
                <hr style={{ margin: '4px 0', borderColor: '#e5e7eb' }} />
                <div>Active POs: <strong>{count}</strong></div>
              </div>
            </Popup>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
