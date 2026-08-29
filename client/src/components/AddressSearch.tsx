import { useState, useRef, useEffect, useCallback } from 'react'
import { geocodeApi, GeoError } from '@/services/api'
import type { GeocodeSuggestion } from '@/types'

// Icon theo category Nominatim
function categoryIcon(cat?: string): string {
  if (!cat) return '📍'
  if (['bus_station', 'bus_stop', 'station'].includes(cat)) return '🚌'
  if (['hospital', 'clinic'].includes(cat)) return '🏥'
  if (['university', 'school', 'college'].includes(cat)) return '🎓'
  if (['restaurant', 'cafe', 'food_court'].includes(cat)) return '🍜'
  if (['hotel', 'hostel', 'motel'].includes(cat)) return '🏨'
  if (['park', 'garden', 'nature_reserve'].includes(cat)) return '🌳'
  if (['supermarket', 'mall', 'department_store', 'marketplace'].includes(cat)) return '🛍️'
  if (['airport'].includes(cat)) return '✈️'
  if (['motorway', 'primary', 'secondary', 'tertiary', 'residential', 'road', 'highway'].includes(cat)) return '🛣️'
  if (['administrative', 'suburb', 'quarter', 'neighbourhood'].includes(cat)) return '🏘️'
  return '📍'
}

interface Props {
  placeholder: string
  value: string
  onSelect: (suggestion: GeocodeSuggestion) => void
  onChange: (value: string) => void
}

export default function AddressSearch({ placeholder, value, onSelect, onChange }: Props) {
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [open, setOpen]               = useState(false)
  const [loading, setLoading]         = useState(false)
  const [activeIdx, setActiveIdx]     = useState(-1)
  const [geoError, setGeoError]       = useState<string | null>(null)
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef    = useRef<HTMLInputElement>(null)

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); setOpen(false); setGeoError(null); return }
    setLoading(true)
    setGeoError(null)
    try {
      const results = await geocodeApi.search(q)
      setSuggestions(results)
      setOpen(results.length > 0)
      setActiveIdx(-1)
    } catch (err) {
      setSuggestions([])
      setOpen(false)
      if (err instanceof GeoError) {
        if (err.code === 'timeout') setGeoError('Tìm kiếm quá thời gian, thử lại')
        else if (err.code === 'network') setGeoError('Không có kết nối mạng')
        else setGeoError('Tìm kiếm thất bại')
      } else {
        setGeoError('Tìm kiếm thất bại')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    onChange(q)
    setGeoError(null)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(q), 380)
  }

  function handleSelect(s: GeocodeSuggestion) {
    onChange(s.shortName + (s.subtitle ? `, ${s.subtitle.split(',')[0]}` : ''))
    onSelect(s)
    setOpen(false)
    setSuggestions([])
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); handleSelect(suggestions[activeIdx]) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  // Close on click outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      {geoError && (
        <p className="text-xs text-red-500 mb-1 px-1 flex items-center gap-1">
          <span>⚠️</span>{geoError}
        </p>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-shadow"
          autoComplete="off"
        />
        {loading ? (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : value && (
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
            onClick={() => { onChange(''); setSuggestions([]); setOpen(false); inputRef.current?.focus() }}
            tabIndex={-1}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-700">
          {suggestions.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s) }}
                className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                  i === activeIdx ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                } ${i === 0 ? 'rounded-t-xl' : ''} ${i === suggestions.length - 1 ? 'rounded-b-xl' : ''}`}
              >
                <span className="text-base mt-0.5 flex-shrink-0">{categoryIcon(s.category)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{s.shortName}</p>
                  {s.subtitle && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{s.subtitle}</p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
