import { useEffect, useRef, useState, useCallback } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import type { LatLngTuple } from 'leaflet'
import type { ETAResult, RouteStop, TrafficSegment, SegmentGeometry } from '@/types'
import type { GeoPosition } from '@/hooks/useGeolocation'
import { geoProxyApi } from '@/services/api'

const DEFAULT_CENTER: [number, number] = [21.0245, 105.8412]

function congestionColor(level: number): string {
  if (level <= 0.3) return '#22c55e'
  if (level <= 0.6) return '#f59e0b'
  return '#ef4444'
}

function validPosition(latValue: unknown, lngValue: unknown): LatLngTuple | null {
  if (latValue === null || latValue === undefined || latValue === '' ||
      lngValue === null || lngValue === undefined || lngValue === '') {
    return null
  }
  const lat = Number(latValue)
  const lng = Number(lngValue)
  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180
  ) {
    return null
  }
  return [lat, lng]
}

function routeStopPosition(routeStop: RouteStop | undefined): LatLngTuple | null {
  return validPosition(routeStop?.stopId?.lat, routeStop?.stopId?.lng)
}

// ─── Sub-components requiring Leaflet map context ─────────────────────────────

function MapController({ stops, selectedStopIndex }: {
  stops: RouteStop[]
  selectedStopIndex: number | null
}) {
  const map = useMap()

  function mapIsVisible(): boolean {
    const container = map.getContainer()
    return container.clientWidth > 0 && container.clientHeight > 0
  }

  useEffect(() => {
    if (stops.length === 0) return
    const coords = stops
      .map(routeStopPosition)
      .filter((position): position is LatLngTuple => position !== null)
    if (coords.length > 0 && mapIsVisible()) {
      const bounds = L.latLngBounds(coords)
      if (!bounds.isValid()) return
      map.stop()
      map.invalidateSize({ animate: false, pan: false })
      map.fitBounds(bounds, { padding: [50, 50], animate: false })
    }
  }, [stops, map])

  useEffect(() => {
    if (selectedStopIndex === null || !mapIsVisible()) return

    const routeStop = stops.find((item) => item.order === selectedStopIndex)
    const position = routeStopPosition(routeStop)
    if (!position) return

    const currentZoom = map.getZoom()
    const targetZoom = Number.isFinite(currentZoom)
      ? Math.max(currentZoom, 16)
      : 16

    map.stop()
    map.invalidateSize({ animate: false, pan: false })
    map.flyTo(position, targetZoom, { animate: true, duration: 0.45 })
  }, [map, selectedStopIndex, stops])

  return null
}

interface StopMarkerProps {
  routeStop: RouteStop
  position: LatLngTuple
  selected: boolean
  routeColor: string
  onSelect: (index: number) => void
  etaResults: ETAResult[]
  etaLoading: boolean
  etaError: string | null
}

function StopMarker({
  routeStop,
  position,
  selected,
  routeColor,
  onSelect,
  etaResults,
  etaLoading,
  etaError,
}: StopMarkerProps) {
  const map = useMap()
  const markerRef = useRef<L.CircleMarker | null>(null)
  const stopName = routeStop.stopId?.name ?? `Trạm ${routeStop.order + 1}`
  const closestBus = etaResults[0]

  useEffect(() => {
    if (!selected) return
    const container = map.getContainer()
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return

    const openPopup = () => markerRef.current?.openPopup()
    map.once('moveend', openPopup)
    const fallbackTimer = window.setTimeout(openPopup, 550)

    return () => {
      map.off('moveend', openPopup)
      window.clearTimeout(fallbackTimer)
    }
  }, [map, selected])

  return (
    <CircleMarker
      ref={markerRef}
      center={position}
      radius={selected ? 11 : 7}
      pathOptions={{
        fillColor: selected ? routeColor : '#ffffff',
        fillOpacity: 1,
        color: routeColor,
        weight: 2.5,
      }}
      eventHandlers={{
        click(event) {
          onSelect(routeStop.order)
          event.target.openPopup()
        },
      }}
    >
      <Popup minWidth={230}>
        <div className="space-y-2 text-sm">
          <div>
            <p className="font-bold text-gray-900">🚏 {stopName}</p>
            {routeStop.stopId?.address && (
              <p className="mt-0.5 text-xs text-gray-500">{routeStop.stopId.address}</p>
            )}
          </div>

          {!selected ? (
            <p className="text-xs text-gray-500">Đang chọn điểm dừng...</p>
          ) : etaLoading ? (
            <p className="text-xs font-medium text-blue-600">Đang tải ETA...</p>
          ) : etaError ? (
            <p className="text-xs text-red-600">{etaError}</p>
          ) : closestBus ? (
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: `${routeColor}14` }}>
              <p className="text-xs text-gray-500">
                {closestBus.source === 'schedule' ? 'ETA ước tính theo lịch' : 'Xe gần nhất'}
              </p>
              <p className="text-lg font-bold" style={{ color: routeColor }}>
                {closestBus.etaMinutes} phút
              </p>
              {closestBus.source === 'schedule' ? (
                <p className="text-xs text-gray-600">Chưa có dữ liệu vị trí xe trực tiếp</p>
              ) : (
                <p className="text-xs text-gray-600">
                  {closestBus.licensePlate} · đang ở trạm {closestBus.currentStopIndex + 1}
                </p>
              )}
              {etaResults.length > 1 && (
                <p className="mt-1 text-xs text-gray-500">
                  Còn {etaResults.length - 1} xe đang hoạt động trên tuyến
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">Hiện chưa có xe đang hoạt động để tính ETA.</p>
          )}
        </div>
      </Popup>
    </CircleMarker>
  )
}

function MapInstanceExtractor({ onMap }: { onMap: (m: L.Map) => void }) {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await geoProxyApi.reverse(lat, lng)
    return res.data.data.displayName ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }

  try {
    const res = await fetch(
      '',
      { headers: { 'User-Agent': 'TransitFlow/1.0' } }
    )
    const data = await res.json()
    return data.display_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
  }
}

// ─── Context menu item sub-components ────────────────────────────────────────

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

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  stops: RouteStop[]
  segments: TrafficSegment[]
  geometry: SegmentGeometry[]
  geometryLoading: boolean
  selectedStopIndex: number | null
  routeColor: string
  userPosition: GeoPosition | null
  onSelectStop: (index: number) => void
  trafficSource?: 'tomtom' | 'simulation' | null
  lastUpdated?: Date | null
  etaResults: ETAResult[]
  etaLoading: boolean
  etaError: string | null
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MapView({
  stops, segments, geometry, geometryLoading,
  selectedStopIndex, routeColor, userPosition, onSelectStop,
  trafficSource, lastUpdated, etaResults, etaLoading, etaError,
}: Props) {
  const navigate = useNavigate()
  const [mapInst, setMapInst] = useState<L.Map | null>(null)
  const [ctx, setCtx] = useState<(CtxPos & { address: string | null; loadingAddr: boolean }) | null>(null)
  const userPositionCoords = userPosition
    ? validPosition(userPosition.lat, userPosition.lng)
    : null

  const openCtx = useCallback((p: CtxPos) => {
    setCtx({ ...p, address: null, loadingAddr: false })
  }, [])
  const closeCtx = useCallback(() => setCtx(null), [])

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtx() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [closeCtx])

  async function handleViewAddress() {
    if (!ctx || ctx.address !== null || ctx.loadingAddr) return
    setCtx((prev) => prev ? { ...prev, loadingAddr: true } : null)
    const addr = await reverseGeocode(ctx.lat, ctx.lng)
    setCtx((prev) => prev ? { ...prev, address: addr, loadingAddr: false } : null)
  }

  function handleSetPoint(type: 'from' | 'to') {
    if (!ctx) return
    const name = (ctx.address ?? `${ctx.lat.toFixed(5)}, ${ctx.lng.toFixed(5)}`)
      .split(',').slice(0, 3).join(',').trim()
    const params = new URLSearchParams({
      [`${type}Lat`]: String(ctx.lat),
      [`${type}Lng`]: String(ctx.lng),
      [`${type}Name`]: name,
    })
    navigate(`/journey?${params}`)
    closeCtx()
  }

  // Flip menu near map edges to keep it fully visible
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={12}
        style={{ width: '100%', height: '100%' }}
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="/map-tiles/{z}/{x}/{y}.png?source=osm-v1"
        />

        <MapInstanceExtractor onMap={setMapInst} />
        <MapController stops={stops} selectedStopIndex={selectedStopIndex} />
        <MapContextMenuHandler onContext={openCtx} onClose={closeCtx} />

        {/* Road geometry from OSRM */}
        {geometry.length > 0
          ? geometry.map((seg) => {
              const ts = segments.find((s) => s.fromOrder === seg.fromOrder && s.toOrder === seg.toOrder)
              const color = ts ? congestionColor(ts.congestionLevel) : routeColor
              const positions = seg.coordinates
                .map(([lat, lng]) => validPosition(lat, lng))
                .filter((position): position is LatLngTuple => position !== null)
              if (positions.length < 2) return null
              return (
                <Polyline
                  key={`geo-${seg.fromOrder}-${seg.toOrder}`}
                  positions={positions}
                  pathOptions={{ color, weight: 5, opacity: 0.9 }}
                />
              )
            })
          : !geometryLoading &&
            stops.slice(0, -1).map((rs, i) => {
              const from = routeStopPosition(rs)
              const to = routeStopPosition(stops[i + 1])
              if (!from || !to) return null
              const ts = segments.find((s) => s.fromOrder === rs.order && s.toOrder === stops[i + 1].order)
              const color = ts ? congestionColor(ts.congestionLevel) : routeColor
              return (
                <Polyline
                  key={`fallback-${i}`}
                  positions={[from, to]}
                  pathOptions={{ color, weight: 4, opacity: 0.6, dashArray: '8 4' }}
                />
              )
            })}

        {/* Loading placeholder lines */}
        {geometryLoading &&
          stops.slice(0, -1).map((rs, i) => {
            const from = routeStopPosition(rs)
            const to = routeStopPosition(stops[i + 1])
            if (!from || !to) return null
            return (
              <Polyline
                key={`loading-${i}`}
                positions={[from, to]}
                pathOptions={{ color: '#d1d5db', weight: 4, opacity: 0.5, dashArray: '6 4' }}
              />
            )
          })}

        {/* Stop markers */}
        {stops.map((rs) => {
          const position = routeStopPosition(rs)
          if (!position) return null
          return (
            <StopMarker
              key={rs._id}
              routeStop={rs}
              position={position}
              selected={rs.order === selectedStopIndex}
              routeColor={routeColor}
              onSelect={onSelectStop}
              etaResults={rs.order === selectedStopIndex ? etaResults : []}
              etaLoading={rs.order === selectedStopIndex && etaLoading}
              etaError={rs.order === selectedStopIndex ? etaError : null}
            />
          )
        })}

        {/* User GPS location */}
        {userPositionCoords && (
          <CircleMarker
            center={userPositionCoords}
            radius={9}
            pathOptions={{ fillColor: '#3b82f6', fillOpacity: 1, color: '#ffffff', weight: 3 }}
          />
        )}
      </MapContainer>

      {/* ── Traffic legend + source badge ───────────────────────────────────── */}
      {segments.length > 0 && (
        <div className="absolute bottom-8 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-xl shadow-md px-3 py-2 text-xs space-y-1 border border-gray-100">
          <p className="font-semibold text-gray-600 text-[10px] uppercase tracking-wide mb-1.5">
            Mật độ giao thông
          </p>
          <div className="flex items-center gap-2">
            <span className="w-4 h-1.5 rounded-full bg-[#22c55e] inline-block" />
            <span className="text-gray-600">Thông thoáng</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-1.5 rounded-full bg-[#f59e0b] inline-block" />
            <span className="text-gray-600">Đông vừa</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-1.5 rounded-full bg-[#ef4444] inline-block" />
            <span className="text-gray-600">Tắc / ùn ứ</span>
          </div>
          <div className="border-t border-gray-100 mt-1.5 pt-1.5">
            <span className={`text-[10px] font-medium ${trafficSource === 'tomtom' ? 'text-blue-600' : 'text-amber-600'}`}>
              {trafficSource === 'tomtom' ? '🔵 TomTom Live' : '🟡 Ước tính theo giờ'}
            </span>
            {lastUpdated && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                Cập nhật {lastUpdated.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Right-click context menu ──────────────────────────────────────────── */}
      {ctx && (
        <div
          className="absolute z-[2000] bg-white rounded-xl shadow-xl border border-gray-100 py-1 overflow-hidden select-none"
          style={{ ...menuStyle(), width: 252 }}
        >
          <MenuItem icon="🟢" label="Chọn làm điểm xuất phát" onClick={() => handleSetPoint('from')} />
          <MenuItem icon="🔴" label="Chọn làm điểm đến" onClick={() => handleSetPoint('to')} />

          <MenuDivider />

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

          <MenuItem icon="🔍" label="Phóng to" onClick={() => { mapInst?.zoomIn(); closeCtx() }} />
          <MenuItem icon="🔎" label="Thu nhỏ" onClick={() => { mapInst?.zoomOut(); closeCtx() }} />
        </div>
      )}
    </div>
  )
}
