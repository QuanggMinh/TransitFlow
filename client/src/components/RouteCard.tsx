import type { Route } from '@/types'

interface Props {
  route: Route
  selected: boolean
  onClick: () => void
}

function RouteCard({ route, selected, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? 'border-current shadow-md'
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-sm'
      }`}
      style={selected ? { borderColor: route.color, backgroundColor: route.color + '15' } : {}}
    >
      <div className="flex items-center gap-3">
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: route.color }} />
        <span className="font-semibold text-gray-900 dark:text-white text-sm">{route.name}</span>
      </div>
      <div className="mt-2 flex gap-3 text-xs text-gray-500 dark:text-gray-400 pl-6 flex-wrap">
        <span>🕐 {route.startTime} – {route.endTime}</span>
        <span>⏱ Mỗi {route.frequency} phút</span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          🎟 {route.price.toLocaleString('vi-VN')}đ
        </span>
      </div>
    </button>
  )
}

export default RouteCard
