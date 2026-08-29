import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import AddressSearch from '@/components/AddressSearch'
import JourneyMap from '@/components/JourneyMap'
import { useJourney } from '@/hooks/useJourney'
import { useFavorites } from '@/hooks/useFavorites'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { geoProxyApi } from '@/services/api'
import { getAccurateCurrentPosition } from '@/utils/accurateGeolocation'
import type { DirectJourney, MultiJourney, GeocodeSuggestion, JourneyOption } from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatPrice(vnd: number): string {
  return vnd.toLocaleString('vi-VN') + 'đ'
}

// ─── POI shortcuts ────────────────────────────────────────────────────────────

const HANOI_POIS = [
  { name: 'Hồ Hoàn Kiếm', lat: 21.0285, lng: 105.8542 },
  { name: 'Ga Hà Nội',     lat: 21.0245, lng: 105.8412 },
  { name: 'BV Bạch Mai',   lat: 21.0000, lng: 105.8397 },
  { name: 'ĐH Bách Khoa',  lat: 21.0045, lng: 105.8443 },
  { name: 'Hồ Tây',        lat: 21.0673, lng: 105.8259 },
  { name: 'Văn Miếu',      lat: 21.0268, lng: 105.8355 },
  { name: 'Vincom Bà Triệu', lat: 21.0125, lng: 105.8477 },
  { name: 'Royal City',    lat: 20.9994, lng: 105.8187 },
]

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortMode = 'walk' | 'time' | 'transfers'

function sortResults(list: JourneyOption[], mode: SortMode): JourneyOption[] {
  const arr = [...list]
  const tc = (j: JourneyOption) => j.type === 'direct' ? 0 : j.transferCount
  const wk = (j: JourneyOption) => j.type === 'direct'
    ? j.walkToBoard + j.walkFromAlight
    : j.walkToBoard + j.walkFromAlight + j.transferWalks.reduce((s, v) => s + v, 0)
  const eta = (j: JourneyOption) => (j.etaMin + j.etaMax) / 2

  if (mode === 'walk') {
    return arr.sort((a, b) =>
      wk(a) - wk(b) || eta(a) - eta(b) || tc(a) - tc(b)
    )
  }

  if (mode === 'time') {
    return arr.sort((a, b) =>
      eta(a) - eta(b) || wk(a) - wk(b) || tc(a) - tc(b)
    )
  }

  return arr.sort((a, b) =>
    tc(a) - tc(b) || wk(a) - wk(b) || eta(a) - eta(b)
  )
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Trình duyệt đã chặn quyền vị trí. Hãy cấp quyền GPS rồi thử lại.'
    case error.POSITION_UNAVAILABLE:
      return 'Không xác định được vị trí hiện tại của thiết bị.'
    case error.TIMEOUT:
      return 'Lấy vị trí quá lâu. Hãy thử lại ở nơi có tín hiệu tốt hơn.'
    default:
      return 'Không thể lấy vị trí hiện tại.'
  }
}

function isGeolocationPositionError(error: unknown): error is GeolocationPositionError {
  return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'number'
}

function compactLocationName(displayName: string | undefined, lat: number, lng: number): string {
  if (!displayName) return `Vị trí hiện tại (${lat.toFixed(5)}, ${lng.toFixed(5)})`
  const shortName = displayName.split(',').slice(0, 3).join(',').trim()
  return `Vị trí hiện tại - ${shortName}`
}

const TRANSFER_LABEL = ['1 lần đổi', '2 lần đổi', '3 lần đổi']

// ─── Timeline sub-components ──────────────────────────────────────────────────

function TimelineWalk({ dist, label, isLast = false }: { dist: number; label: string; isLast?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-8 flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isLast ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
          <span className="text-base leading-none">{isLast ? '📍' : '🚶'}</span>
        </div>
        {!isLast && <div className="w-0.5 bg-gray-200 dark:bg-gray-600 flex-1 my-1" style={{ minHeight: 16 }} />}
      </div>
      <div className={`${!isLast ? 'pb-3' : ''} pt-0.5 min-w-0`}>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Đi bộ {formatDistance(dist)}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

function TimelineBus({ color, routeShort, from, to, stopsCount, intermediateStops }: {
  color: string; routeShort: string; from: string; to: string
  stopsCount: number; intermediateStops: string[]
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-8 flex-shrink-0">
        <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: color + '22' }}>
          <span className="text-base leading-none">🚌</span>
        </div>
        <div className="w-0.5 bg-gray-200 dark:bg-gray-600 flex-1 my-1" style={{ minHeight: 16 }} />
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full text-white mr-1.5" style={{ backgroundColor: color }}>{routeShort}</span>
          {stopsCount} trạm
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          <span className="font-medium text-gray-700 dark:text-gray-200">{from}</span>
          <span className="mx-1">→</span>
          <span className="font-medium text-gray-700 dark:text-gray-200">{to}</span>
        </p>
        {intermediateStops.length > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="text-xs text-blue-500 dark:text-blue-400 mt-1.5 underline underline-offset-2">
            {expanded ? 'Ẩn trạm trung gian' : `Xem ${intermediateStops.length} trạm trung gian`}
          </button>
        )}
        {expanded && (
          <ul className="mt-2 space-y-1 pl-1">
            {intermediateStops.map((name, i) => (
              <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function TimelineTransfer({ fromStop, toStop, dist }: { fromStop: string; toStop: string; dist: number }) {
  const same = fromStop === toStop
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center w-8 flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <span className="text-base leading-none">🔄</span>
        </div>
        <div className="w-0.5 bg-gray-200 dark:bg-gray-600 flex-1 my-1" style={{ minHeight: 16 }} />
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          {same ? 'Đổi tuyến tại chỗ' : `Đi bộ đổi tuyến ${formatDistance(dist)}`}
        </p>
        {!same && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            <span className="font-medium text-gray-700 dark:text-gray-200">{fromStop}</span>
            <span className="mx-1">→</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{toStop}</span>
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Journey cards ────────────────────────────────────────────────────────────

interface CardProps { journey: JourneyOption; selected: boolean; onSelect: () => void }

function DirectCard({ journey, selected, onSelect }: { journey: DirectJourney } & Omit<CardProps, 'journey'>) {
  const totalWalk = journey.walkToBoard + journey.walkFromAlight
  return (
    <div
      className={`rounded-2xl border-2 overflow-hidden cursor-pointer transition-all ${selected ? 'shadow-md' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-sm'}`}
      style={selected ? { borderColor: journey.route.color, backgroundColor: journey.route.color + '08' } : {}}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderLeft: `4px solid ${journey.route.color}` }}>
        <span className="text-xs font-bold px-2 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: journey.route.color }}>
          {journey.route.name.split(' - ')[0]}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{journey.route.name}</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-gray-500 dark:text-gray-400">Mỗi {journey.route.frequency} phút</p>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">🎟 {formatPrice(journey.route.price)}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-violet-600 dark:text-violet-400">⏱ {journey.etaMin}–{journey.etaMax} phút</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">đi bộ {formatDistance(totalWalk)}</p>
          {selected && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white block mt-0.5" style={{ backgroundColor: journey.route.color }}>Đang xem</span>}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <TimelineWalk dist={journey.walkToBoard} label={`đến bến ${journey.boardStop.name}`} />
        <TimelineBus color={journey.route.color} routeShort={journey.route.name.split(' - ')[0]}
          from={journey.boardStop.name} to={journey.alightStop.name}
          stopsCount={journey.stopsCount} intermediateStops={journey.intermediateStops} />
        <TimelineWalk dist={journey.walkFromAlight} label={`từ ${journey.alightStop.name} đến điểm đến`} isLast />
      </div>
    </div>
  )
}

function MultiCard({ journey, selected, onSelect }: { journey: MultiJourney } & Omit<CardProps, 'journey'>) {
  const totalWalk = journey.walkToBoard + journey.walkFromAlight + journey.transferWalks.reduce((s, v) => s + v, 0)
  const totalPrice = journey.segments.reduce((s, seg) => s + seg.route.price, 0)
  const firstColor = journey.segments[0].route.color
  const lastColor  = journey.segments[journey.segments.length - 1].route.color
  return (
    <div
      className={`rounded-2xl border-2 overflow-hidden cursor-pointer transition-all ${selected ? 'shadow-md' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-sm'}`}
      style={selected ? { borderColor: firstColor, backgroundColor: firstColor + '06' } : {}}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-l-4" style={{ borderLeftColor: firstColor }}>
        <div className="flex items-center gap-1 flex-1 min-w-0 flex-wrap">
          {journey.segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-xs font-bold px-2 py-1 rounded-full text-white flex-shrink-0" style={{ backgroundColor: seg.route.color }}>
                {seg.route.name.split(' - ')[0]}
              </span>
              {i < journey.segments.length - 1 && <span className="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">→</span>}
            </span>
          ))}
          <span className="ml-1 text-[10px] bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0">
            {TRANSFER_LABEL[journey.transferCount - 1] ?? `${journey.transferCount} lần đổi`}
          </span>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-violet-600 dark:text-violet-400">⏱ {journey.etaMin}–{journey.etaMax} phút</p>
          <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">🎟 {formatPrice(totalPrice)}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">đi bộ {formatDistance(totalWalk)}</p>
          {selected && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full text-white block mt-0.5" style={{ backgroundColor: lastColor }}>Đang xem</span>}
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <TimelineWalk dist={journey.walkToBoard} label={`đến bến ${journey.segments[0].boardStop.name}`} />
        {journey.segments.map((seg, i) => (
          <span key={i}>
            <TimelineBus color={seg.route.color} routeShort={seg.route.name.split(' - ')[0]}
              from={seg.boardStop.name} to={seg.alightStop.name}
              stopsCount={seg.stopsCount} intermediateStops={seg.intermediateStops} />
            {i < journey.segments.length - 1 && (
              <TimelineTransfer fromStop={seg.alightStop.name}
                toStop={journey.segments[i + 1].boardStop.name}
                dist={journey.transferWalks[i] ?? 0} />
            )}
          </span>
        ))}
        <TimelineWalk dist={journey.walkFromAlight}
          label={`từ ${journey.segments[journey.segments.length - 1].alightStop.name} đến điểm đến`}
          isLast />
      </div>
    </div>
  )
}

function JourneyCard({ journey, selected, onSelect }: CardProps) {
  if (journey.type === 'multi') return <MultiCard journey={journey} selected={selected} onSelect={onSelect} />
  return <DirectCard journey={journey} selected={selected} onSelect={onSelect} />
}

// ─── Search panel ─────────────────────────────────────────────────────────────

interface SearchPanelProps {
  fromText: string; toText: string
  fromCoords: { lat: number; lng: number } | null
  toCoords: { lat: number; lng: number } | null
  loading: boolean; searched: boolean
  onFromText: (v: string) => void; onFromSelect: (s: GeocodeSuggestion) => void
  onToText: (v: string) => void; onToSelect: (s: GeocodeSuggestion) => void
  onSearch: () => void; onReset: () => void
  onSwap: () => void
  onUseCurrentLocation: () => void
  locatingCurrent: boolean
  locationError: string | null
  currentLocationAccuracy: number | null
  gpsImprovement: number | null
  departureTime: string | null
  onDepartureChange: (v: string | null) => void
  onShare: () => void
  shareFeedback: boolean
}

function SearchPanel({
  fromText, toText, fromCoords, toCoords, loading,
  onFromText, onFromSelect, onToText, onToSelect, onSearch, onReset,
  onSwap, onUseCurrentLocation, locatingCurrent, locationError, currentLocationAccuracy, gpsImprovement,
  departureTime, onDepartureChange, onShare, shareFeedback,
}: SearchPanelProps) {
  const canSearch = fromCoords !== null && toCoords !== null && !loading

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-stretch">
        <div className="flex flex-col items-center justify-between py-3 flex-shrink-0">
          <span className="w-3 h-3 rounded-full bg-green-500" />
          <div className="w-0.5 flex-1 my-1 bg-gray-300" />
          <span className="w-3 h-3 rounded-full bg-red-500" />
        </div>
        <div className="flex-1 space-y-2 min-w-0">
          <AddressSearch placeholder="Điểm xuất phát..." value={fromText}
            onChange={v => onFromText(v)} onSelect={onFromSelect} />
          <AddressSearch placeholder="Điểm đến..." value={toText}
            onChange={v => onToText(v)} onSelect={onToSelect} />
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onSwap}
            title="Đổi chiều điểm đi và điểm đến"
            className="h-11 w-11 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-600 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onUseCurrentLocation}
            disabled={locatingCurrent}
            title="Dùng vị trí hiện tại làm điểm xuất phát"
            className="h-11 w-11 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 disabled:opacity-70 disabled:cursor-wait transition-colors flex items-center justify-center"
            aria-label="Dùng vị trí hiện tại làm điểm xuất phát"
          >
            {locatingCurrent ? (
              <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <span className="text-lg leading-none">📍</span>
            )}
          </button>
        </div>
      </div>

      {!fromCoords && fromText.length >= 2 && (
        <p className="text-xs text-amber-600 flex items-center gap-1 px-1">
          <span>⚠️</span> Chọn gợi ý từ danh sách để xác nhận điểm xuất phát
        </p>
      )}
      {fromCoords && currentLocationAccuracy !== null && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 px-1">
          <span>✓</span> Đã tối ưu GPS, sai số khoảng {Math.round(currentLocationAccuracy)} m
          {gpsImprovement !== null && gpsImprovement > 0 && ` (tốt hơn mẫu đầu ${gpsImprovement}%)`}
        </p>
      )}
      {locationError && (
        <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 px-1">
          <span>⚠️</span> {locationError}
        </p>
      )}
      {!toCoords && toText.length >= 2 && (
        <p className="text-xs text-amber-600 flex items-center gap-1 px-1">
          <span>⚠️</span> Chọn gợi ý từ danh sách để xác nhận điểm đến
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 flex-shrink-0">🕐 Khởi hành:</span>
        <button
          type="button"
          onClick={() => onDepartureChange(null)}
          className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors flex-shrink-0 ${
            !departureTime ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          Ngay bây giờ
        </button>
        <input
          type="time"
          value={departureTime ?? ''}
          onChange={e => onDepartureChange(e.target.value || null)}
          className={`text-xs px-2 py-1 rounded-lg border transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 ${
            departureTime ? 'border-blue-300 text-blue-700 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700' : 'border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-800'
          }`}
        />
      </div>

      <div className="flex gap-2">
        <button onClick={onSearch} disabled={!canSearch}
          className="flex-1 h-11 rounded-xl text-sm font-semibold text-white bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed active:bg-blue-700 transition-colors">
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Đang tìm...
            </span>
          ) : 'Tìm đường'}
        </button>
        {(fromText || toText) && (
          <button onClick={onReset}
            className="h-11 px-4 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 active:bg-gray-100 dark:active:bg-gray-700 transition-colors">
            Xóa
          </button>
        )}
        {fromCoords && toCoords && (
          <button
            type="button"
            onClick={onShare}
            title="Chia sẻ hành trình"
            className={`h-11 px-3 rounded-xl border text-sm transition-colors flex-shrink-0 flex items-center gap-1.5 ${
              shareFeedback
                ? 'border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-700'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            {shareFeedback ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-medium">Đã copy</span>
              </>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function JourneyPage() {
  const [searchParams] = useSearchParams()

  const [fromText, setFromText]     = useState(() => searchParams.get('fromName') ?? '')
  const [toText, setToText]         = useState(() => searchParams.get('toName')   ?? '')
  const [fromCoords, setFromCoords] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = searchParams.get('fromLat'), lng = searchParams.get('fromLng')
    return lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null
  })
  const [toCoords, setToCoords] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = searchParams.get('toLat'), lng = searchParams.get('toLng')
    return lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : null
  })

  const [selectedJourney, setSelectedJourney] = useState<JourneyOption | null>(null)
  const [mobileTab, setMobileTab]   = useState<'list' | 'map'>('list')
  const [sortMode, setSortMode]     = useState<SortMode>('walk')
  const [savedFeedback, setSavedFeedback] = useState(false)
  const [departureTime, setDepartureTime] = useState<string | null>(() => searchParams.get('departureAt') ?? null)
  const [shareFeedback, setShareFeedback] = useState(false)
  const [locatingCurrent, setLocatingCurrent] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)
  const [currentLocationAccuracy, setCurrentLocationAccuracy] = useState<number | null>(null)
  const [gpsImprovement, setGpsImprovement] = useState<number | null>(null)

  const { results, loading, error, searched, findJourney, reset } = useJourney()
  const { favorites, addFavorite, removeFavorite } = useFavorites()
  const { recents, pushRecent } = useRecentSearches()

  const sortedResults = useMemo(() => sortResults(results, sortMode), [results, sortMode])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleSearch() {
    if (!fromCoords || !toCoords) return
    setSelectedJourney(null)
    pushRecent({ fromName: fromText, fromLat: fromCoords.lat, fromLng: fromCoords.lng,
                 toName: toText,   toLat: toCoords.lat,   toLng: toCoords.lng })
    findJourney(fromCoords.lat, fromCoords.lng, toCoords.lat, toCoords.lng, departureTime ?? undefined)
  }

  function handleReset() {
    setFromText(''); setToText('')
    setFromCoords(null); setToCoords(null)
    setSelectedJourney(null)
    setSortMode('walk')
    setDepartureTime(null)
    setLocationError(null)
    setCurrentLocationAccuracy(null)
    reset()
  }

  async function handleUseCurrentLocation() {
    if (!window.isSecureContext) {
      setLocationError('GPS không hoạt động trên HTTP qua địa chỉ mạng LAN. Hãy truy cập ứng dụng bằng HTTPS rồi thử lại.')
      setCurrentLocationAccuracy(null)
      return
    }

    if (!navigator.geolocation) {
      setLocationError('Trình duyệt không hỗ trợ Geolocation API.')
      setCurrentLocationAccuracy(null)
      return
    }

    setLocatingCurrent(true)
    setLocationError(null)
    setCurrentLocationAccuracy(null)
    setGpsImprovement(null)

    try {
      const position = await getAccurateCurrentPosition()
      const lat = position.lat
      const lng = position.lng

      setFromCoords({ lat, lng })
      setCurrentLocationAccuracy(position.accuracy)
      setGpsImprovement(position.improvementPercent)
      setSelectedJourney(null)
      setMobileTab('list')

      try {
        const res = await geoProxyApi.reverse(lat, lng)
        setFromText(compactLocationName(res.data.data?.displayName, lat, lng))
      } catch {
        setFromText(compactLocationName(undefined, lat, lng))
      }
    } catch (err) {
      setCurrentLocationAccuracy(null)
      setLocationError(isGeolocationPositionError(err) ? geolocationErrorMessage(err) : 'Không thể lấy vị trí hiện tại.')
    } finally {
      setLocatingCurrent(false)
    }
  }

  function handleFromSelect(s: GeocodeSuggestion) {
    setFromCoords({ lat: s.lat, lng: s.lng })
    setFromText(s.shortName + (s.subtitle ? `, ${s.subtitle.split(',')[0]}` : ''))
    setLocationError(null)
    setCurrentLocationAccuracy(null)
  }

  function handleToSelect(s: GeocodeSuggestion) {
    setToCoords({ lat: s.lat, lng: s.lng })
    setToText(s.shortName + (s.subtitle ? `, ${s.subtitle.split(',')[0]}` : ''))
  }

  function handleQuickFill(name: string, lat: number, lng: number) {
    if (!fromCoords) {
      setFromText(name); setFromCoords({ lat, lng })
      setLocationError(null); setCurrentLocationAccuracy(null)
    } else {
      setToText(name); setToCoords({ lat, lng })
    }
    setSelectedJourney(null)
  }

  function handleLoadRecent(r: typeof recents[0]) {
    setFromText(r.fromName); setFromCoords({ lat: r.fromLat, lng: r.fromLng })
    setToText(r.toName);   setToCoords({ lat: r.toLat,   lng: r.toLng })
    setSelectedJourney(null)
    setLocationError(null); setCurrentLocationAccuracy(null)
    pushRecent(r)
    findJourney(r.fromLat, r.fromLng, r.toLat, r.toLng, departureTime ?? undefined)
  }

  function handleSaveFavorite() {
    if (!fromCoords || !fromText) return
    addFavorite({
      label: fromText.split(',')[0].trim().slice(0, 20),
      name: fromText, lat: fromCoords.lat, lng: fromCoords.lng,
    })
    setSavedFeedback(true)
    setTimeout(() => setSavedFeedback(false), 2000)
  }

  function handleMapSetFrom(lat: number, lng: number, name: string) {
    setFromCoords({ lat, lng }); setFromText(name)
    setLocationError(null); setCurrentLocationAccuracy(null)
    setSelectedJourney(null); setMobileTab('list')
  }

  function handleMapSetTo(lat: number, lng: number, name: string) {
    setToCoords({ lat, lng }); setToText(name)
    setSelectedJourney(null); setMobileTab('list')
  }

  function handleSwap() {
    setFromText(toText); setToText(fromText)
    setFromCoords(toCoords); setToCoords(fromCoords)
    setLocationError(null); setCurrentLocationAccuracy(null)
    setSelectedJourney(null)
  }

  async function handleShare() {
    if (!fromCoords || !toCoords) return
    const params = new URLSearchParams({
      fromLat: String(fromCoords.lat), fromLng: String(fromCoords.lng), fromName: fromText,
      toLat: String(toCoords.lat), toLng: String(toCoords.lng), toName: toText,
      ...(departureTime ? { departureAt: departureTime } : {}),
    })
    const url = `${window.location.origin}/journey?${params}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url; document.body.appendChild(el); el.select()
      document.execCommand('copy'); document.body.removeChild(el)
    }
    setShareFeedback(true)
    setTimeout(() => setShareFeedback(false), 2500)
  }

  // ── Shared search props ──────────────────────────────────────────────────────

  const searchProps: SearchPanelProps = {
    fromText, toText, fromCoords, toCoords, loading, searched,
    onFromText: v => { setFromText(v); setFromCoords(null); setLocationError(null); setCurrentLocationAccuracy(null) },
    onFromSelect: handleFromSelect,
    onToText: v => { setToText(v); setToCoords(null) },
    onToSelect: handleToSelect,
    onSearch: handleSearch,
    onReset: handleReset,
    onSwap: handleSwap,
    onUseCurrentLocation: handleUseCurrentLocation,
    locatingCurrent,
    locationError,
    currentLocationAccuracy,
    gpsImprovement,
    departureTime,
    onDepartureChange: setDepartureTime,
    onShare: handleShare,
    shareFeedback,
  }

  // ── "Địa điểm nhanh" row ─────────────────────────────────────────────────────

  const quickFillRow = (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Địa điểm nhanh</p>
        {fromCoords && fromText && (
          <button onClick={handleSaveFavorite}
            className={`text-[11px] flex items-center gap-1 transition-colors ${savedFeedback ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500 hover:text-amber-600'}`}>
            {savedFeedback ? '✓ Đã lưu' : '⭐ Lưu điểm xuất phát'}
          </button>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {favorites.map(f => (
          <div key={f.id} className="flex-shrink-0 flex items-center rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs">
            <button onClick={() => handleQuickFill(f.name, f.lat, f.lng)}
              className="px-2.5 py-1.5 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-full whitespace-nowrap">
              ⭐ {f.label}
            </button>
            <button onClick={() => removeFavorite(f.id)}
              className="pr-2.5 text-amber-300 dark:text-amber-600 hover:text-amber-500 leading-none">✕</button>
          </div>
        ))}
        {HANOI_POIS.map(p => (
          <button key={p.name} onClick={() => handleQuickFill(p.name, p.lat, p.lng)}
            className="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 whitespace-nowrap transition-colors">
            {p.name}
          </button>
        ))}
      </div>
    </div>
  )

  // ── Results content ──────────────────────────────────────────────────────────

  const resultsContent = (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {loading && (
        <div className="flex flex-col items-center py-16 gap-3 text-gray-400 dark:text-gray-500">
          <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Đang tìm hành trình...</p>
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className="flex flex-col items-center py-14 text-center gap-3">
          <span className="text-5xl">😕</span>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Không tìm thấy tuyến xe phù hợp</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">
            Điểm xuất phát hoặc điểm đến cách các bến xe buýt hiện có quá 2 km.
          </p>
        </div>
      )}

      {!searched && !loading && recents.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide px-1">Tìm kiếm gần đây</p>
          {recents.map((r, i) => (
            <button key={i} onClick={() => handleLoadRecent(r)}
              className="w-full text-left px-4 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm transition-all">
              <div className="flex items-center gap-2.5">
                <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 text-base">🕐</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-700 dark:text-gray-200">
                    <span className="font-semibold">{r.fromName.split(',')[0]}</span>
                    <span className="mx-1.5 text-gray-300 dark:text-gray-600">→</span>
                    <span className="font-semibold">{r.toName.split(',')[0]}</span>
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {r.fromName} → {r.toName}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {!searched && !loading && recents.length === 0 && (
        <div className="flex flex-col items-center py-14 text-center gap-3">
          <span className="text-5xl">🗺️</span>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">Nhập điểm đi và điểm đến</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">
            Hệ thống tìm tuyến xe buýt phù hợp và chỉ đường đi bộ đến bến gần nhất.
          </p>
        </div>
      )}

      {sortedResults.length > 0 && !loading && (
        <>
          <div className="flex items-center gap-1.5">
            {(['walk', 'time', 'transfers'] as SortMode[]).map((mode, i) => {
              const labels = ['Ít đi bộ', 'Nhanh nhất', 'Ít đổi tuyến']
              return (
                <button key={mode} onClick={() => setSortMode(mode)}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    sortMode === mode
                      ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                      : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                  {labels[i]}
                </button>
              )
            })}
            {departureTime && (
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-full flex-shrink-0">
                🕐 {departureTime}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{sortedResults.length} phương án</span>
          </div>

          {sortedResults.map((j, i) => (
            <JourneyCard key={i} journey={j} selected={selectedJourney === j}
              onSelect={() => { setSelectedJourney(j); setMobileTab('map') }} />
          ))}
          <div className="h-4" />
        </>
      )}
    </div>
  )

  // ── Desktop layout ────────────────────────────────────────────────────────────

  const desktop = (
    <div className="hidden md:flex h-[calc(100vh-64px)]">
      <div className="w-[420px] flex-shrink-0 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
        <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 shadow-sm px-4 pt-4 pb-3 space-y-3">
          <SearchPanel {...searchProps} />
          {quickFillRow}
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">{resultsContent}</div>
      </div>
      <div className="flex-1 relative">
        <JourneyMap journey={selectedJourney} fromCoords={fromCoords} toCoords={toCoords}
          onSetFrom={handleMapSetFrom} onSetTo={handleMapSetTo} />
      </div>
    </div>
  )

  // ── Mobile layout ─────────────────────────────────────────────────────────────

  const mobile = (
    <div className="md:hidden flex flex-col h-[calc(100vh-56px)]">
      <div className="flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 shadow-sm px-4 pt-3 pb-3 z-20 space-y-3">
        <SearchPanel {...searchProps} />
        {quickFillRow}
      </div>

      {(searched || selectedJourney) && (
        <div className="flex-shrink-0 flex border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-900">
          <button onClick={() => setMobileTab('list')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${mobileTab === 'list' ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white' : 'text-gray-400 dark:text-gray-500'}`}>
            Lộ trình
          </button>
          <button onClick={() => setMobileTab('map')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${mobileTab === 'map' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-400 dark:text-gray-500'}`}>
            Bản đồ {selectedJourney && '●'}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {mobileTab === 'map' ? (
          <JourneyMap journey={selectedJourney} fromCoords={fromCoords} toCoords={toCoords}
            onSetFrom={handleMapSetFrom} onSetTo={handleMapSetTo} />
        ) : (
          <div className="h-full overflow-y-auto px-4 py-4 bg-gray-50 dark:bg-gray-900">{resultsContent}</div>
        )}
      </div>
    </div>
  )

  return <>{desktop}{mobile}</>
}
