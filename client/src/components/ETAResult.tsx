import type { ETAResult } from '@/types'

interface Props {
  results: ETAResult[]
  loading: boolean
  error: string | null
  stopName: string
  routeColor: string
}

function ETAResult({ results, loading, error, stopName, routeColor }: Props) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
        <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-1/2 mb-3" />
        <div className="h-16 bg-gray-100 dark:bg-gray-700 rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
        {error}
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div
        className="overflow-hidden rounded-xl border-2 bg-white shadow-sm dark:bg-gray-800"
        style={{ borderColor: routeColor }}
      >
        <div className="px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: routeColor }}>
          🚏 Trạm: {stopName}
        </div>
        <div className="p-5">
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            Chưa có xe đang hoạt động
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Hệ thống chưa nhận được vị trí của xe nào trên tuyến nên chưa thể tính ETA đến điểm dừng này.
          </p>
        </div>
      </div>
    )
  }

  const closest = results[0]

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border-2 shadow-sm overflow-hidden" style={{ borderColor: routeColor }}>
      <div className="px-5 py-3 text-white text-sm font-semibold" style={{ backgroundColor: routeColor }}>
        🚏 Trạm: {stopName}
      </div>

      <div className="p-5">
        <div className="mb-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1">
            {closest.source === 'schedule' ? 'ETA ước tính theo lịch' : 'Xe gần nhất'}
          </p>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold text-gray-900 dark:text-white">{closest.etaMinutes}</span>
            <span className="text-lg text-gray-500 dark:text-gray-400 mb-1">phút</span>
            {closest.etaMinutes === 0 && (
              <span className="mb-1 text-green-600 dark:text-green-400 font-semibold text-sm">— Đã đến!</span>
            )}
          </div>
          {closest.source === 'schedule' ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Chưa có vị trí xe trực tiếp; thời gian được tính theo lịch xuất bến.
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Biển số: <span className="font-mono font-medium text-gray-700 dark:text-gray-200">{closest.licensePlate}</span>
              {' · '}đang ở trạm số {closest.currentStopIndex + 1}
            </p>
          )}
        </div>

        {results.length > 1 && (
          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Các xe tiếp theo</p>
            <div className="flex flex-col gap-2">
              {results.slice(1).map((bus) => (
                <div key={String(bus.busId)} className="flex items-center justify-between text-sm">
                  <span className="font-mono text-gray-600 dark:text-gray-300">
                    {bus.source === 'schedule' ? 'Chuyến dự kiến tiếp theo' : bus.licensePlate}
                  </span>
                  <span className="text-gray-700 dark:text-gray-200 font-semibold">{bus.etaMinutes} phút</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ETAResult
