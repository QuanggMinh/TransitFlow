import type { RouteStop } from '@/types'

interface Props {
  stops: RouteStop[]
  loading: boolean
  selectedIndex: number | null
  routeColor: string
  onSelect: (index: number) => void
}

function StopList({ stops, loading, selectedIndex, routeColor, onSelect }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <ol className="relative">
      {stops.map((rs, idx) => {
        const isSelected = selectedIndex === rs.order
        const isFirst = idx === 0
        const isLast = idx === stops.length - 1

        return (
          <li key={rs._id} className="flex items-stretch gap-3">
            <div className="flex flex-col items-center w-6 flex-shrink-0">
              <div className={`w-0.5 flex-1 ${isFirst ? 'bg-transparent' : 'bg-gray-200 dark:bg-gray-600'}`} />
              <div
                className="w-3 h-3 rounded-full border-2 z-10 flex-shrink-0"
                style={isSelected
                  ? { borderColor: routeColor, backgroundColor: routeColor }
                  : { borderColor: '#9ca3af', backgroundColor: 'transparent' }}
              />
              <div className={`w-0.5 flex-1 ${isLast ? 'bg-transparent' : 'bg-gray-200 dark:bg-gray-600'}`} />
            </div>

            <button
              onClick={() => onSelect(rs.order)}
              className={`flex-1 text-left py-2 px-3 mb-1 rounded-lg transition-all ${
                isSelected ? 'shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
              style={isSelected ? { backgroundColor: routeColor + '15' } : {}}
            >
              <p className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-200'}`}>
                {(rs.stopId as any)?.name ?? '—'}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{(rs.stopId as any)?.address ?? ''}</p>
              {rs.distanceFromPrev > 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  +{(rs.distanceFromPrev / 1000).toFixed(1)} km từ trạm trước
                </p>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

export default StopList
