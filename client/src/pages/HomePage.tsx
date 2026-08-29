import { useState, useEffect } from 'react'
import { useRoutes } from '@/hooks/useRoutes'
import { useRouteStops } from '@/hooks/useRouteStops'
import { useETA } from '@/hooks/useETA'
import { useTrafficSegments } from '@/hooks/useTrafficSegments'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useRouteGeometry } from '@/hooks/useRouteGeometry'
import RouteCard from '@/components/RouteCard'
import StopList from '@/components/StopList'
import ETAResult from '@/components/ETAResult'
import MapView from '@/components/MapView'
import type { Route } from '@/types'

// ─── Lịch chạy theo giờ ──────────────────────────────────────────────────────

function getUpcomingTimes(
  startTime: string, endTime: string, frequency: number, count = 3,
): { label: string; minsAway: number }[] {
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins   = eh * 60 + em

  const times: { label: string; minsAway: number }[] = []
  let cur = startMins
  while (cur <= endMins) {
    if (cur >= nowMins) {
      const h = Math.floor(cur / 60).toString().padStart(2, '0')
      const m = (cur % 60).toString().padStart(2, '0')
      times.push({ label: `${h}:${m}`, minsAway: cur - nowMins })
      if (times.length >= count) break
    }
    cur += frequency
  }
  return times
}

function NextBusTimes({ startTime, endTime, frequency }: { startTime: string; endTime: string; frequency: number }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const times = getUpcomingTimes(startTime, endTime, frequency, 3)

  if (times.length === 0) {
    return <p className="text-xs text-orange-500 mt-1.5 font-medium">Hết chuyến hôm nay</p>
  }
  return (
    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
      <span className="text-xs text-gray-400">Tiếp theo:</span>
      {times.map((t, i) => (
        <span
          key={i}
          className={`text-xs font-semibold rounded-md px-1.5 py-0.5 ${
            i === 0 ? 'bg-emerald-100 text-emerald-700' : 'text-gray-400'
          }`}
        >
          {t.label}
          {i === 0 && t.minsAway <= 90 && (
            <span className="ml-1 font-normal">
              {t.minsAway === 0 ? '(ngay bây giờ)' : `(${t.minsAway} phút)`}
            </span>
          )}
        </span>
      ))}
      {/* trigger re-render when now changes */}
      <span className="hidden">{now.getMinutes()}</span>
    </div>
  )
}

// Tab dùng cho bottom sheet trên mobile
type MobileTab = 'routes' | 'stops' | 'eta'

function HomePage() {
  const { routes, loading: routesLoading, error: routesError } = useRoutes()
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
  const [selectedStopIndex, setSelectedStopIndex] = useState<number | null>(null)
  const [selectedStopName, setSelectedStopName] = useState('')
  const [mobileTab, setMobileTab] = useState<MobileTab>('routes')
  const [sheetOpen, setSheetOpen] = useState(true)

  const { stops, loading: stopsLoading } = useRouteStops(selectedRoute?._id ?? null)
  const { segments, trafficSource, lastUpdated } = useTrafficSegments(selectedRoute?._id ?? null)
  const { geometry, loading: geometryLoading } = useRouteGeometry(selectedRoute?._id ?? null)
  const { results, loading: etaLoading, error: etaError, fetchETA, reset } = useETA()
  const { position: userPosition } = useGeolocation()

  function handleSelectRoute(route: Route) {
    setSelectedRoute(route)
    setSelectedStopIndex(null)
    setSelectedStopName('')
    reset()
    setMobileTab('stops')
  }

  function handleSelectStop(index: number) {
    if (!selectedRoute) return
    const rs = stops.find((s) => s.order === index)
    const name = (rs?.stopId as any)?.name ?? `Trạm ${index + 1}`
    setSelectedStopIndex(index)
    setSelectedStopName(name)
    fetchETA(selectedRoute._id, index)
    setMobileTab('eta')
  }

  // ─── Desktop layout ────────────────────────────────────────────────────────
  const desktopLayout = (
    <div className="hidden md:flex h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <aside className="w-80 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">

        <div className="flex flex-col min-h-0 max-h-[55%] border-b border-gray-100 dark:border-gray-700">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide flex-shrink-0 px-4 pt-4 pb-2">
            Chọn tuyến xe
          </p>
          {routesLoading && (
            <div className="flex flex-col gap-2 px-4 pb-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />)}
            </div>
          )}
          {routesError && <p className="text-sm text-red-500 dark:text-red-400 px-4 pb-3">{routesError}</p>}
          <div className="overflow-y-auto flex-1 px-4 pb-4 flex flex-col gap-2">
            {routes.map((route) => (
              <RouteCard key={route._id} route={route} selected={selectedRoute?._id === route._id} onClick={() => handleSelectRoute(route)} />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!selectedRoute ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-300 dark:text-gray-600">
              <span className="text-4xl mb-2">🗺️</span>
              <p className="text-sm">Chọn tuyến để xem trạm dừng</p>
            </div>
          ) : (
            <>
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">Chọn trạm đến</p>
              <StopList stops={stops} loading={stopsLoading} selectedIndex={selectedStopIndex} routeColor={selectedRoute.color} onSelect={handleSelectStop} />
            </>
          )}
        </div>
      </aside>

      {/* Map + ETA panel */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 relative">
          {!selectedRoute ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600">
              <span className="text-6xl mb-3">🚌</span>
              <p className="text-base">Chọn một tuyến xe để xem bản đồ</p>
            </div>
          ) : (
            <MapView stops={stops} segments={segments} geometry={geometry} geometryLoading={geometryLoading} selectedStopIndex={selectedStopIndex} routeColor={selectedRoute.color} userPosition={userPosition} onSelectStop={handleSelectStop} trafficSource={trafficSource} lastUpdated={lastUpdated} etaResults={results} etaLoading={etaLoading} etaError={etaError} />
          )}
        </div>

        {selectedRoute && (
          <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4 flex gap-4 items-start">
            <div
              className="flex-shrink-0 px-4 py-3 rounded-xl text-sm"
              style={{ backgroundColor: selectedRoute.color + '15', borderLeft: `3px solid ${selectedRoute.color}` }}
            >
              <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{selectedRoute.name}</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
                {selectedRoute.startTime} – {selectedRoute.endTime} · Mỗi {selectedRoute.frequency} phút
              </p>
              <NextBusTimes startTime={selectedRoute.startTime} endTime={selectedRoute.endTime} frequency={selectedRoute.frequency} />
            </div>
            <div className="flex-1">
              {selectedStopIndex === null ? (
                <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-sm">
                  <span>🕐</span>
                  <span>Click vào một trạm để xem thời gian đến</span>
                </div>
              ) : (
                <ETAResult results={results} loading={etaLoading} error={etaError} stopName={selectedStopName} routeColor={selectedRoute.color} />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )

  // ─── Mobile layout ─────────────────────────────────────────────────────────
  const mobileLayout = (
    <div className="md:hidden flex flex-col h-[calc(100vh-56px)]">

      <div className="flex-1 relative">
        {!selectedRoute ? (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600">
            <span className="text-5xl mb-2">🚌</span>
            <p className="text-sm">Chọn tuyến xe bên dưới</p>
          </div>
        ) : (
          <MapView stops={stops} segments={segments} geometry={geometry} geometryLoading={geometryLoading} selectedStopIndex={selectedStopIndex} routeColor={selectedRoute.color} userPosition={userPosition} onSelectStop={handleSelectStop} etaResults={results} etaLoading={etaLoading} etaError={etaError} />
        )}

        {userPosition && (
          <div className="absolute top-3 right-3 z-[1000] bg-white dark:bg-gray-800 rounded-full shadow px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium flex items-center gap-1">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse inline-block" />
            GPS
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div className="bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex flex-col" style={{ maxHeight: sheetOpen ? '55%' : '56px' }}>

        <div className="flex items-center border-b border-gray-100 dark:border-gray-700 px-2 flex-shrink-0">
          <button
            className="py-3 px-2 text-gray-400"
            onClick={() => setSheetOpen((o) => !o)}
            aria-label="toggle panel"
          >
            <div className="w-8 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
          </button>

          <button
            onClick={() => { setMobileTab('routes'); setSheetOpen(true) }}
            className={`flex-1 py-3 text-xs font-semibold transition-colors ${mobileTab === 'routes' ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white' : 'text-gray-400 dark:text-gray-500'}`}
          >
            Tuyến xe
          </button>
          <button
            onClick={() => { setMobileTab('stops'); setSheetOpen(true) }}
            disabled={!selectedRoute}
            className={`flex-1 py-3 text-xs font-semibold transition-colors disabled:opacity-30 ${mobileTab === 'stops' ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white' : 'text-gray-400 dark:text-gray-500'}`}
          >
            Trạm dừng
          </button>
          <button
            onClick={() => { setMobileTab('eta'); setSheetOpen(true) }}
            disabled={selectedStopIndex === null}
            className={`flex-1 py-3 text-xs font-semibold transition-colors disabled:opacity-30 ${mobileTab === 'eta' ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white' : 'text-gray-400 dark:text-gray-500'}`}
          >
            ETA
          </button>
        </div>

        {sheetOpen && (
          <div className="flex-1 overflow-y-auto p-4">
            {mobileTab === 'routes' && (
              <div className="flex flex-col gap-3">
                {routesLoading && [...Array(3)].map((_, i) => (
                  <div key={i} className="h-14 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
                ))}
                {routes.map((route) => (
                  <RouteCard key={route._id} route={route} selected={selectedRoute?._id === route._id} onClick={() => handleSelectRoute(route)} />
                ))}
              </div>
            )}

            {mobileTab === 'stops' && selectedRoute && (
              <>
                <div className="mb-3 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-xs">
                  <p className="text-gray-500 dark:text-gray-400">{selectedRoute.startTime} – {selectedRoute.endTime} · Mỗi {selectedRoute.frequency} phút</p>
                  <NextBusTimes startTime={selectedRoute.startTime} endTime={selectedRoute.endTime} frequency={selectedRoute.frequency} />
                </div>
                <StopList stops={stops} loading={stopsLoading} selectedIndex={selectedStopIndex} routeColor={selectedRoute.color} onSelect={handleSelectStop} />
              </>
            )}

            {mobileTab === 'eta' && selectedRoute && selectedStopIndex !== null && (
              <ETAResult results={results} loading={etaLoading} error={etaError} stopName={selectedStopName} routeColor={selectedRoute.color} />
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      {desktopLayout}
      {mobileLayout}
    </>
  )
}

export default HomePage
