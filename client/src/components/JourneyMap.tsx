import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet'
import type { Map as LMap, LatLngBoundsExpression } from 'leaflet'
import type { JourneyOption, JourneyStop } from '@/types'
import { geoProxyApi, routeApi } from '@/services/api'

const DEFAULT_CENTER: [number, number] = [21.0245, 105.8412]

// ─── OSRM geometry helpers ────────────────────────────────────────────────────

type LatLng = { lat: number; lng: number }

async function osrmRoute(profile: string, from: LatLng, to: LatLng): Promise<[number, number][]> {
  try {
    const res = await geoProxyApi.route(profile === 'foot' ? 'foot' : 'driving', from.lat, from.lng, to.lat, to.lng)
    const coords = res.data.data.coordinates as [number, number][]
    return coords?.length ? coords : [[from.lat, from.lng], [to.lat, to.lng]]
  } catch (err: any) {
    console.warn(`[Geo proxy/${profile}] Error: ${err instanceof Error ? err.message : err}`)
    return [[from.lat, from.lng], [to.lat, to.lng]]
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const url = ''
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'http' })
    const data = await res.json()
    const coords = data.routes?.[0]?.geometry?.coordinates
    if (!coords?.length) {
      console.warn(`[OSRM/${profile}] No route found between points`)
      return [[from.lat, from.lng], [to.lat, to.lng]]
    }
    return coords.map(([lng, lat]: [number, number]) => [lat, lng] as [number, number])
  } catch (err: any) {
    if (err instanceof DOMException && err.name === 'AbortError')
      console.warn(`[OSRM/${profile}] Timeout (6s) — falling back to straight line`)
    else if (err instanceof TypeError)
      console.warn(`[OSRM/${profile}] Network error — no connection to OSRM`)
    else
      console.warn(`[OSRM/${profile}] Error: ${err instanceof Error ? err.message : err}`)
    return [[from.lat, from.lng], [to.lat, to.lng]]
  } finally {
    clearTimeout(timer)
  }
}

async function fetchBusGeometry(
  routeId: string,
  from: JourneyStop,
  to: JourneyStop,
): Promise<[number, number][]> {
  try {
    const response = await routeApi.getGeometry(routeId)
    const segments = response.data.data as Array<{
      fromOrder: number
      toOrder: number
      coordinates: [number, number][]
    }>
    return segments
      .filter((segment) => segment.fromOrder >= from.order && segment.toOrder <= to.order)
      .flatMap((segment, index) => index === 0 ? segment.coordinates : segment.coordinates.slice(1))
  } catch (err: any) {
    console.warn(`[Route geometry/${routeId}] Error: ${err instanceof Error ? err.message : err}`)
    return [[from.lat, from.lng], [to.lat, to.lng]]
  }
}

async function fetchWalkGeometry(from: LatLng, to: LatLng): Promise<[number, number][]> {
  // Try foot profile; if OSRM returns no route (public server may not have foot), fall back to driving
  const geo = await osrmRoute('foot', from, to)
  if (geo.length === 2 && geo[0][0] === from.lat && geo[0][1] === from.lng) {
    return osrmRoute('driving', from, to)
  }
  return geo
}

// ─── Reverse geocode ──────────────────────────────────────────────────────────

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await geoProxyApi.reverse(lat, lng)
    return res.data.data.displayName ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch (err: any) {
    console.warn(`[Geo proxy/reverse] Error: ${err instanceof Error ? err.message : err}`)
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      '',
      { headers: { 'User-Agent': 'TransitFlow/1.0' }, signal: controller.signal }
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch (err: any) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[Nominatim reverse] Timeout (8s)')
      return `${lat.toFixed(5)}, ${lng.toFixed(5)} (chưa tải được địa chỉ)`
    }
    if (err instanceof TypeError) console.warn('[Nominatim reverse] Network error')
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } finally {
    clearTimeout(timer)
  }
}

// ─── Map sub-components ───────────────────────────────────────────────────────

function BoundsController({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length < 2) return
    const lats = points.map(p => p[0]), lngs = points.map(p => p[1])
    const bounds: LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ]
    map.fitBounds(bounds, { padding: [52, 52], animate: true })
  }, [points, map])
  return null
}

function MapInstanceExtractor({ onMap }: { onMap: (m: LMap) => void }) {
  const map = useMap()
  const stable = useRef(onMap)
  stable.current = onMap
  useEffect(() => { stable.current(map) }, [map])
  return null
}

interface CtxPos { x: number; y: number; lat: number; lng: number }

function MapContextMenuHandler({ onContext, onClose }: {
  onContext: (p: CtxPos) => void
  onClose: () => void
}) {
  useMapEvents({
    contextmenu(e) {
      e.originalEvent.preventDefault()
      onContext({ x: e.containerPoint.x, y: e.containerPoint.y, lat: e.latlng.lat, lng: e.latlng.lng })
    },
    click() { onClose() },
    drag() { onClose() },
  })
  return null
}

function StopMarker({ stop, color, label }: { stop: JourneyStop; color: string; label: string }) {
  return (
    <CircleMarker
      center={[stop.lat, stop.lng]}
      radius={9}
      pathOptions={{ fillColor: color, fillOpacity: 1, color: '#fff', weight: 2.5 }}
    >
      <Popup>
        <strong>{stop.name}</strong>
        <br /><span style={{ fontSize: 12, color: '#6b7280' }}>{label}</span>
      </Popup>
    </CircleMarker>
  )
}

// ─── Context menu UI ──────────────────────────────────────────────────────────

function MenuItem({ icon, label, onClick, disabled = false }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
        disabled ? 'text-gray-300 cursor-default' : 'text-gray-700 hover:bg-blue-50 active:bg-blue-100 cursor-pointer'
      }`}
      onClick={disabled ? undefined : onClick}
    >
      <span className="w-5 text-center text-base leading-none flex-shrink-0">{icon}</span>
      {label}
    </button>
  )
}

function MenuDivider() {
  return <div className="h-px bg-gray-100 my-1 mx-3" />
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  journey: JourneyOption | null
  fromCoords: { lat: number; lng: number } | null
  toCoords: { lat: number; lng: number } | null
  onSetFrom?: (lat: number, lng: number, name: string) => void
  onSetTo?: (lat: number, lng: number, name: string) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function JourneyMap({ journey, fromCoords, toCoords, onSetFrom, onSetTo }: Props) {
  const [segGeos, setSegGeos]         = useState<[number, number][][]>([])
  const [walkFromGeo, setWalkFromGeo] = useState<[number, number][]>([])
  const [walkToGeo, setWalkToGeo]     = useState<[number, number][]>([])
  const [transferGeos, setTransferGeos] = useState<[number, number][][]>([])
  const [mapInst, setMapInst] = useState<LMap | null>(null)
  const [ctx, setCtx] = useState<(CtxPos & { address: string | null; loadingAddr: boolean }) | null>(null)

  // Fetch road geometry for bus segments
  useEffect(() => {
    setSegGeos([])
    if (!journey) return

    let cancelled = false
    const segs = journey.type === 'direct'
      ? [{ routeId: journey.route._id, boardStop: journey.boardStop, alightStop: journey.alightStop }]
      : journey.segments.map(s => ({ routeId: s.route._id, boardStop: s.boardStop, alightStop: s.alightStop }))

    Promise.all(segs.map(s => fetchBusGeometry(s.routeId, s.boardStop, s.alightStop)))
      .then((geometry) => { if (!cancelled) setSegGeos(geometry) })
    return () => { cancelled = true }
  }, [journey])

  // Fetch walk geometry (changes when journey, fromCoords, or toCoords change)
  useEffect(() => {
    setWalkFromGeo([])
    setWalkToGeo([])
    setTransferGeos([])
    if (!journey) return

    const firstBoard = journey.type === 'direct' ? journey.boardStop : journey.segments[0].boardStop
    const lastAlight = journey.type === 'direct' ? journey.alightStop : journey.segments[journey.segments.length - 1].alightStop

    if (fromCoords && journey.walkToBoard > 0) {
      fetchWalkGeometry(fromCoords, firstBoard).then(setWalkFromGeo)
    }
    if (toCoords && journey.walkFromAlight > 0) {
      fetchWalkGeometry(lastAlight, toCoords).then(setWalkToGeo)
    }
    if (journey.type === 'multi' && journey.transferWalks.length > 0) {
      const pairs = journey.segments.slice(0, -1).map((seg, i) => ({
        from: seg.alightStop,
        to: journey.segments[i + 1].boardStop,
        dist: journey.transferWalks[i] ?? 0,
      }))
      Promise.all(pairs.map(p => p.dist > 0 ? fetchWalkGeometry(p.from, p.to) : Promise.resolve<[number,number][]>([]))).then(setTransferGeos)
    }
  }, [journey, fromCoords, toCoords])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // useMemo prevents BoundsController from re-firing when ctx state changes
  const allPoints = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = []
    if (fromCoords) pts.push([fromCoords.lat, fromCoords.lng])
    if (journey) {
      if (journey.type === 'direct') {
        pts.push([journey.boardStop.lat, journey.boardStop.lng])
        pts.push([journey.alightStop.lat, journey.alightStop.lng])
      } else {
        for (const seg of journey.segments) {
          pts.push([seg.boardStop.lat, seg.boardStop.lng])
          pts.push([seg.alightStop.lat, seg.alightStop.lng])
        }
      }
    }
    if (toCoords) pts.push([toCoords.lat, toCoords.lng])
    return pts
  }, [journey, fromCoords, toCoords])

  // Derive segment list for rendering
  const segments = journey?.type === 'direct'
    ? [{ boardStop: journey.boardStop, alightStop: journey.alightStop, color: journey.route.color, name: journey.route.name }]
    : journey?.type === 'multi'
      ? journey.segments.map(s => ({ boardStop: s.boardStop, alightStop: s.alightStop, color: s.route.color, name: s.route.name }))
      : []

  function menuStyle(): React.CSSProperties {
    if (!ctx) return {}
    const menuW = 252, menuH = 300
    const cw = mapInst?.getContainer().clientWidth ?? 500
    const ch = mapInst?.getContainer().clientHeight ?? 400
    return {
      left: ctx.x + menuW > cw ? Math.max(0, ctx.x - menuW) : ctx.x,
      top: ctx.y + menuH > ch ? Math.max(0, ctx.y - menuH) : ctx.y,
    }
  }

  function pointName(lat: number, lng: number): string {
    return (ctx?.address ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`)
      .split(',').slice(0, 3).join(',').trim()
  }

  async function handleViewAddress() {
    if (!ctx || ctx.address !== null || ctx.loadingAddr) return
    setCtx(prev => prev ? { ...prev, loadingAddr: true } : null)
    const addr = await reverseGeocode(ctx.lat, ctx.lng)
    setCtx(prev => prev ? { ...prev, address: addr, loadingAddr: false } : null)
  }

  function handleSetFrom() {
    if (!ctx || !onSetFrom) return
    onSetFrom(ctx.lat, ctx.lng, pointName(ctx.lat, ctx.lng))
    setCtx(null)
  }

  function handleSetTo() {
    if (!ctx || !onSetTo) return
    onSetTo(ctx.lat, ctx.lng, pointName(ctx.lat, ctx.lng))
    setCtx(null)
  }

  return (
    <div className="w-full h-full relative">
      <MapContainer center={DEFAULT_CENTER} zoom={13} style={{ width: '100%', height: '100%' }} zoomControl>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="/map-tiles/{z}/{x}/{y}.png?source=osm-v1"
        />
        <MapInstanceExtractor onMap={setMapInst} />
        <MapContextMenuHandler onContext={p => setCtx({ ...p, address: null, loadingAddr: false })} onClose={() => setCtx(null)} />
        {allPoints.length >= 2 && <BoundsController points={allPoints} />}

        {/* Walk from origin to first board stop */}
        {journey && fromCoords && journey.walkToBoard > 0 && (
          <Polyline
            positions={walkFromGeo.length > 0
              ? walkFromGeo
              : [[fromCoords.lat, fromCoords.lng], [segments[0].boardStop.lat, segments[0].boardStop.lng]]}
            pathOptions={{ color: '#22c55e', weight: 4, dashArray: '8 5', opacity: 0.9 }}
          />
        )}

        {/* Bus segments */}
        {segments.map((seg, i) => (
          <Polyline
            key={i}
            positions={segGeos[i]?.length > 0
              ? segGeos[i]
              : [[seg.boardStop.lat, seg.boardStop.lng], [seg.alightStop.lat, seg.alightStop.lng]]}
            pathOptions={segGeos[i]?.length > 0
              ? { color: seg.color, weight: 5, opacity: 0.9 }
              : { color: seg.color, weight: 4, opacity: 0.35, dashArray: '6 4' }}
          />
        ))}

        {/* Transfer walks between segments */}
        {journey?.type === 'multi' && journey.segments.slice(0, -1).map((seg, i) => {
          const geo = transferGeos[i]
          const fallback: [number, number][] = [
            [seg.alightStop.lat, seg.alightStop.lng],
            [journey.segments[i + 1].boardStop.lat, journey.segments[i + 1].boardStop.lng],
          ]
          if ((journey.transferWalks[i] ?? 0) === 0) return null
          return (
            <Polyline
              key={`transfer-${i}`}
              positions={geo?.length > 0 ? geo : fallback}
              pathOptions={{ color: '#f59e0b', weight: 4, dashArray: '8 5', opacity: 0.9 }}
            />
          )
        })}

        {/* Walk from last alight stop to destination */}
        {journey && toCoords && journey.walkFromAlight > 0 && (
          <Polyline
            positions={walkToGeo.length > 0
              ? walkToGeo
              : [[segments[segments.length - 1].alightStop.lat, segments[segments.length - 1].alightStop.lng], [toCoords.lat, toCoords.lng]]}
            pathOptions={{ color: '#ef4444', weight: 4, dashArray: '8 5', opacity: 0.9 }}
          />
        )}

        {/* Markers */}
        {fromCoords && (
          <CircleMarker center={[fromCoords.lat, fromCoords.lng]} radius={11}
            pathOptions={{ fillColor: '#22c55e', fillOpacity: 1, color: '#fff', weight: 3 }}>
            <Popup><strong>Điểm xuất phát</strong></Popup>
          </CircleMarker>
        )}

        {segments.map((seg, i) => (
          <React.Fragment key={`marker-${i}`}>
            <StopMarker
              stop={seg.boardStop}
              color={seg.color}
              label={i === 0 ? 'Lên xe' : `Lên ${seg.name.split(' - ')[0]}`}
            />
            {i === segments.length - 1 && (
              <StopMarker stop={seg.alightStop} color={seg.color} label="Xuống xe" />
            )}
            {i < segments.length - 1 && (
              <StopMarker
                stop={seg.alightStop}
                color={seg.color}
                label={`Xuống ${seg.name.split(' - ')[0]} — trung chuyển`}
              />
            )}
          </React.Fragment>
        ))}

        {toCoords && (
          <CircleMarker center={[toCoords.lat, toCoords.lng]} radius={11}
            pathOptions={{ fillColor: '#ef4444', fillOpacity: 1, color: '#fff', weight: 3 }}>
            <Popup><strong>Điểm đến</strong></Popup>
          </CircleMarker>
        )}
      </MapContainer>

      {/* Legend */}
      {journey && (
        <div className="absolute bottom-6 left-3 z-[1000] bg-white/92 backdrop-blur-sm rounded-xl shadow border border-gray-100 px-3 py-2 text-xs space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed border-green-500 inline-block" />
            <span className="text-gray-600">Đi bộ</span>
          </div>
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 border-t-[3px] inline-block" style={{ borderColor: seg.color }} />
              <span className="text-gray-600">{seg.name.split(' - ')[0]}</span>
            </div>
          ))}
          {journey.type === 'multi' && (
            <div className="flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-amber-400 inline-block" />
              <span className="text-gray-600">Trung chuyển</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed border-red-400 inline-block" />
            <span className="text-gray-600">Đến đích</span>
          </div>
        </div>
      )}

      {!journey && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50/70 z-[500] pointer-events-none">
          <span className="text-5xl mb-3">🗺️</span>
          <p className="text-sm font-medium text-gray-500">Chọn một phương án để xem trên bản đồ</p>
        </div>
      )}

      {/* Right-click context menu */}
      {ctx && (
        <div
          className="absolute z-[2000] bg-white rounded-xl shadow-xl border border-gray-100 py-1 overflow-hidden select-none"
          style={{ ...menuStyle(), width: 252 }}
        >
          {onSetFrom && <MenuItem icon="🟢" label="Chọn làm điểm xuất phát" onClick={handleSetFrom} />}
          {onSetTo   && <MenuItem icon="🔴" label="Chọn làm điểm đến"        onClick={handleSetTo} />}
          {(onSetFrom || onSetTo) && <MenuDivider />}

          <div>
            <MenuItem
              icon="📌"
              label="Xem địa chỉ"
              onClick={handleViewAddress}
              disabled={ctx.loadingAddr || ctx.address !== null}
            />
            {(ctx.loadingAddr || ctx.address) && (
              <div className="px-4 pb-2.5 pl-[52px] -mt-1">
                {ctx.loadingAddr ? (
                  <span className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin inline-block flex-shrink-0" />
                    Đang tải địa chỉ...
                  </span>
                ) : (
                  <p className="text-xs text-gray-600 leading-relaxed break-words">{ctx.address}</p>
                )}
              </div>
            )}
          </div>

          <MenuDivider />
          <MenuItem icon="🔍" label="Phóng to"  onClick={() => { mapInst?.zoomIn();  setCtx(null) }} />
          <MenuItem icon="🔎" label="Thu nhỏ"   onClick={() => { mapInst?.zoomOut(); setCtx(null) }} />
        </div>
      )}
    </div>
  )
}
