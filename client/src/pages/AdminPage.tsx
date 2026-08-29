import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { adminApi } from '@/services/api'
import AdminLocationMap from '@/components/AdminLocationMap'
import type { Route, RouteStop, Stop } from '@/types'

type AdminTab = 'routes' | 'stops'

interface AdminStats {
  routes: number
  activeRoutes: number
  stops: number
  routeStops: number
}

interface StopMeta {
  page: number
  limit: number
  total: number
  pages: number
}

interface RouteDraft {
  name: string
  color: string
  status: 'active' | 'inactive'
  startTime: string
  endTime: string
  frequency: string
  price: string
}

interface StopDraft {
  name: string
  address: string
  lat: string
  lng: string
}

function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message ?? 'Không thể kết nối tới máy chủ'
  }
  return error instanceof Error ? error.message : 'Đã xảy ra lỗi'
}

function routeDraft(route: Route): RouteDraft {
  return {
    name: route.name,
    color: route.color,
    status: route.status,
    startTime: route.startTime,
    endTime: route.endTime,
    frequency: String(route.frequency),
    price: String(route.price),
  }
}

function stopDraft(stop: Stop): StopDraft {
  return {
    name: stop.name,
    address: stop.address,
    lat: String(stop.lat),
    lng: String(stop.lng),
  }
}

function newRouteDraft(): RouteDraft {
  return {
    name: '',
    color: '#2563EB',
    status: 'active',
    startTime: '05:00',
    endTime: '22:00',
    frequency: '15',
    price: '7000',
  }
}

function newStopDraft(): StopDraft {
  return {
    name: '',
    address: '',
    lat: '21.028511',
    lng: '105.854444',
  }
}

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-900/40'
const labelClass = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

export default function AdminPage() {
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)

  const [tab, setTab] = useState<AdminTab>('routes')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null)
  const [routeForm, setRouteForm] = useState<RouteDraft | null>(null)
  const [creatingRoute, setCreatingRoute] = useState(false)
  const [routeStops, setRouteStops] = useState<RouteStop[]>([])
  const [savedRouteStops, setSavedRouteStops] = useState<RouteStop[]>([])
  const [routeStopsLoading, setRouteStopsLoading] = useState(false)
  const [routeStopBusy, setRouteStopBusy] = useState(false)
  const [draggedRouteStopId, setDraggedRouteStopId] = useState<string | null>(null)
  const [dragOverRouteStopId, setDragOverRouteStopId] = useState<string | null>(null)
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateStops, setCandidateStops] = useState<Stop[]>([])
  const [insertPosition, setInsertPosition] = useState(0)

  const [stops, setStops] = useState<Stop[]>([])
  const [stopMeta, setStopMeta] = useState<StopMeta>({ page: 1, limit: 30, total: 0, pages: 1 })
  const [stopSearch, setStopSearch] = useState('')
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null)
  const [stopForm, setStopForm] = useState<StopDraft | null>(null)
  const [creatingStop, setCreatingStop] = useState(false)

  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadStops = useCallback(async (query: string, page = 1) => {
    try {
      const response = await adminApi.stops(query, page)
      setStops(response.data.data)
      setStopMeta(response.data.meta)
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setAuthenticated(false)
      } else {
        setError(errorMessage(requestError))
      }
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const [statsResponse, routesResponse] = await Promise.all([
        adminApi.stats(),
        adminApi.routes(),
      ])
      setStats(statsResponse.data.data)
      setRoutes(routesResponse.data.data)
      await loadStops('', 1)
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
        setAuthenticated(false)
      } else {
        setError(errorMessage(requestError))
      }
    }
  }, [loadStops])

  const loadRouteStops = useCallback(async (routeId: string) => {
    setRouteStopsLoading(true)
    try {
      const response = await adminApi.routeStops(routeId)
      setRouteStops(response.data.data)
      setSavedRouteStops(response.data.data)
      setInsertPosition(response.data.data.length)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setRouteStopsLoading(false)
    }
  }, [])

  useEffect(() => {
    adminApi.session()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    if (authenticated) loadDashboard()
  }, [authenticated, loadDashboard])

  useEffect(() => {
    if (!authenticated) return
    const timer = window.setTimeout(() => loadStops(stopSearch, 1), 300)
    return () => window.clearTimeout(timer)
  }, [authenticated, loadStops, stopSearch])

  useEffect(() => {
    if (!authenticated || !selectedRoute || creatingRoute) {
      setCandidateStops([])
      return
    }
    const timer = window.setTimeout(() => {
      adminApi.stops(candidateSearch, 1, 20)
        .then((response) => {
          const assigned = new Set(routeStops.map((item) => item.stopId._id))
          setCandidateStops(response.data.data.filter((stop: Stop) => !assigned.has(stop._id)))
        })
        .catch((requestError) => setError(errorMessage(requestError)))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [authenticated, candidateSearch, creatingRoute, routeStops, selectedRoute])

  const validStopPosition = useMemo(() => {
    if (!stopForm) return null
    const lat = Number(stopForm.lat)
    const lng = Number(stopForm.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null
    }
    return { lat, lng }
  }, [stopForm])

  const routeStopsDirty = useMemo(() => {
    if (routeStops.length !== savedRouteStops.length) return true
    return routeStops.some(
      (item, index) => item.stopId._id !== savedRouteStops[index]?.stopId._id,
    )
  }, [routeStops, savedRouteStops])

  useEffect(() => {
    if (!routeStopsDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [routeStopsDirty])

  async function handleLogin(event: FormEvent) {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError(null)
    try {
      await adminApi.login(username, password)
      setPassword('')
      setAuthenticated(true)
    } catch (requestError) {
      setLoginError(errorMessage(requestError))
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await adminApi.logout()
    } finally {
      setAuthenticated(false)
      setRoutes([])
      setStops([])
    }
  }

  function chooseRoute(route: Route) {
    if (selectedRoute?._id === route._id) return
    if (
      routeStopsDirty &&
      !window.confirm('Các thay đổi điểm dừng chưa được lưu. Hủy bản nháp và mở tuyến khác?')
    ) return
    setCreatingRoute(false)
    setSelectedRoute(route)
    setRouteForm(routeDraft(route))
    setNotice(null)
    setError(null)
    setCandidateSearch('')
    loadRouteStops(route._id)
  }

  function chooseStop(stop: Stop) {
    setCreatingStop(false)
    setSelectedStop(stop)
    setStopForm(stopDraft(stop))
    setNotice(null)
    setError(null)
  }

  function startNewRoute() {
    if (
      routeStopsDirty &&
      !window.confirm('Các thay đổi điểm dừng chưa được lưu. Hủy bản nháp và tạo tuyến mới?')
    ) return
    setCreatingRoute(true)
    setSelectedRoute(null)
    setRouteForm(newRouteDraft())
    setRouteStops([])
    setSavedRouteStops([])
    setNotice(null)
    setError(null)
  }

  function startNewStop() {
    setCreatingStop(true)
    setSelectedStop(null)
    setStopForm(newStopDraft())
    setNotice(null)
    setError(null)
  }

  async function saveRoute(event: FormEvent) {
    event.preventDefault()
    if (!routeForm || (!creatingRoute && !selectedRoute)) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = {
        ...routeForm,
        frequency: Number(routeForm.frequency),
        price: Number(routeForm.price),
      }
      const response = creatingRoute
        ? await adminApi.createRoute(payload)
        : await adminApi.updateRoute(selectedRoute!._id, payload)
      const updated: Route = response.data.data
      setRoutes((items) => {
        const next = creatingRoute
          ? [...items, updated]
          : items.map((item) => item._id === updated._id ? updated : item)
        return next.sort((left, right) => left.name.localeCompare(right.name, 'vi'))
      })
      if (creatingRoute) {
        setStats((current) => current ? {
          ...current,
          routes: current.routes + 1,
          activeRoutes: current.activeRoutes + (updated.status === 'active' ? 1 : 0),
        } : current)
      }
      setSelectedRoute(updated)
      setRouteForm(routeDraft(updated))
      setCreatingRoute(false)
      if (creatingRoute) await loadRouteStops(updated._id)
      setNotice(creatingRoute ? 'Đã tạo tuyến xe mới.' : 'Đã cập nhật thông tin tuyến xe.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedRoute() {
    if (!selectedRoute || creatingRoute) return
    const confirmed = window.confirm(
      `Xóa tuyến "${selectedRoute.name}"? Tất cả liên kết điểm dừng, xe và lịch sử vị trí của xe thuộc tuyến này cũng sẽ bị xóa.`,
    )
    if (!confirmed) return

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const response = await adminApi.deleteRoute(selectedRoute._id)
      const sourceManaged = Boolean(response.data.data?.sourceManaged)
      setSelectedRoute(null)
      setRouteForm(null)
      setCreatingRoute(false)
      setRouteStops([])
      setSavedRouteStops([])
      setCandidateStops([])
      await loadDashboard()
      setNotice(sourceManaged
        ? 'Đã xóa tuyến. Lưu ý: tuyến thuộc dữ liệu nguồn và có thể được tạo lại khi chạy đồng bộ dữ liệu.'
        : 'Đã xóa tuyến xe và dữ liệu liên quan.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  function addRouteStop(stopId: string) {
    if (!selectedRoute) return
    const stop = candidateStops.find((item) => item._id === stopId)
    if (!stop) return
    setError(null)
    const position = Math.max(0, Math.min(insertPosition, routeStops.length))
    const draft: RouteStop = {
      _id: `draft:${stopId}:${Date.now()}`,
      routeId: selectedRoute._id,
      stopId: stop,
      order: position,
      distanceFromPrev: 0,
    }
    const updated = [...routeStops]
    updated.splice(position, 0, draft)
    setRouteStops(updated)
    setInsertPosition(Math.min(position + 1, updated.length))
    setNotice('Đã thêm vào bản nháp. Bấm “Lưu danh sách điểm dừng” để áp dụng.')
  }

  function removeRouteStopLink(routeStop: RouteStop) {
    if (!selectedRoute || !window.confirm(`Gỡ "${routeStop.stopId.name}" khỏi bản nháp? Điểm dừng gốc sẽ không bị xóa.`)) return
    setError(null)
    const updated = routeStops.filter((item) => item._id !== routeStop._id)
    setRouteStops(updated)
    setInsertPosition(Math.min(insertPosition, updated.length))
    setNotice('Đã gỡ khỏi bản nháp. Thay đổi chưa được lưu.')
  }

  function startRouteStopDrag(event: DragEvent<HTMLElement>, routeStopId: string) {
    if (routeStopBusy) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', routeStopId)
    setDraggedRouteStopId(routeStopId)
  }

  function dropRouteStop(event: DragEvent<HTMLDivElement>, targetIndex: number) {
    event.preventDefault()
    const draggedId = draggedRouteStopId || event.dataTransfer.getData('text/plain')
    const sourceIndex = routeStops.findIndex((item) => item._id === draggedId)
    if (sourceIndex < 0) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const dropAfter = event.clientY > bounds.top + bounds.height / 2
    let insertIndex = targetIndex + (dropAfter ? 1 : 0)
    const reordered = [...routeStops]
    const [dragged] = reordered.splice(sourceIndex, 1)
    if (sourceIndex < insertIndex) insertIndex -= 1
    reordered.splice(Math.max(0, Math.min(insertIndex, reordered.length)), 0, dragged)

    setDraggedRouteStopId(null)
    setDragOverRouteStopId(null)
    if (reordered.every((item, index) => item._id === routeStops[index]._id)) return
    setError(null)
    setRouteStops(reordered)
    setNotice('Đã kéo điểm dừng sang vị trí mới trong bản nháp. Thay đổi chưa được lưu.')
  }

  function endRouteStopDrag() {
    setDraggedRouteStopId(null)
    setDragOverRouteStopId(null)
  }

  async function saveRouteStopDraft() {
    if (!selectedRoute || !routeStopsDirty) return
    setRouteStopBusy(true)
    setError(null)
    try {
      const response = await adminApi.saveRouteStops(
        selectedRoute._id,
        routeStops.map((item) => item.stopId._id),
        savedRouteStops.map((item) => item._id),
      )
      const updated: RouteStop[] = response.data.data
      const countDelta = updated.length - savedRouteStops.length
      setRouteStops(updated)
      setSavedRouteStops(updated)
      setInsertPosition(updated.length)
      setStats((current) => current
        ? { ...current, routeStops: current.routeStops + countDelta }
        : current)
      setNotice('Đã lưu danh sách điểm dừng và cập nhật dữ liệu tra cứu hành trình.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setRouteStopBusy(false)
    }
  }

  function cancelRouteStopDraft() {
    setRouteStops(savedRouteStops)
    setInsertPosition(savedRouteStops.length)
    setError(null)
    setNotice('Đã hủy bản nháp; dữ liệu tuyến vẫn giữ nguyên như trước.')
  }

  function changeTab(nextTab: AdminTab) {
    if (
      tab !== nextTab &&
      routeStopsDirty &&
      !window.confirm('Các thay đổi điểm dừng chưa được lưu. Hủy bản nháp và chuyển mục?')
    ) return
    if (tab !== nextTab && routeStopsDirty) cancelRouteStopDraft()
    setTab(nextTab)
  }

  async function saveStop(event: FormEvent) {
    event.preventDefault()
    if ((!creatingStop && !selectedStop) || !stopForm || !validStopPosition) {
      setError('Tọa độ điểm dừng không hợp lệ.')
      return
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const payload = {
        name: stopForm.name,
        address: stopForm.address,
        lat: validStopPosition.lat,
        lng: validStopPosition.lng,
      }
      const response = creatingStop
        ? await adminApi.createStop(payload)
        : await adminApi.updateStop(selectedStop!._id, payload)
      const updated: Stop = response.data.data
      if (creatingStop) {
        setStopSearch('')
        await loadStops('', 1)
        setStats((current) => current ? { ...current, stops: current.stops + 1 } : current)
      } else {
        setStops((items) => items.map((item) => item._id === updated._id ? updated : item))
      }
      setSelectedStop(updated)
      setStopForm(stopDraft(updated))
      setCreatingStop(false)
      setNotice(creatingStop ? 'Đã tạo điểm dừng mới.' : 'Đã cập nhật điểm dừng và vị trí trên bản đồ.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  async function deleteSelectedStop() {
    if (!selectedStop || creatingStop) return
    const confirmed = window.confirm(
      `Xóa điểm dừng "${selectedStop.name}"? Điểm này sẽ bị gỡ khỏi tất cả tuyến đang sử dụng và không thể hoàn tác trong trang quản trị.`,
    )
    if (!confirmed) return

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const deletedStopId = selectedStop._id
      const response = await adminApi.deleteStop(deletedStopId)
      const sourceManaged = Boolean(response.data.data?.sourceManaged)
      setSelectedStop(null)
      setStopForm(null)
      setCreatingStop(false)
      setStopSearch('')
      setCandidateStops((items) => items.filter((item) => item._id !== deletedStopId))
      await loadDashboard()
      if (selectedRoute) await loadRouteStops(selectedRoute._id)
      setNotice(sourceManaged
        ? 'Đã xóa điểm dừng khỏi mọi tuyến. Lưu ý: điểm thuộc dữ liệu nguồn và có thể được tạo lại khi chạy đồng bộ dữ liệu.'
        : 'Đã xóa điểm dừng khỏi hệ thống và mọi tuyến liên quan.')
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Đang kiểm tra phiên quản trị...
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto bg-gray-50 px-4 dark:bg-gray-900">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900/40">🔐</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Quản trị TransitFlow</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Đăng nhập để chỉnh sửa dữ liệu vận tải.</p>
          </div>
          <label className={labelClass} htmlFor="admin-username">Tên đăng nhập</label>
          <input id="admin-username" name="username" className={inputClass} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
          <label className={`${labelClass} mt-4`} htmlFor="admin-password">Mật khẩu</label>
          <input id="admin-password" name="password" className={inputClass} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          {loginError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{loginError}</p>}
          <button disabled={loginLoading} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60">
            {loginLoading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bảng điều khiển quản trị</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Quản lý tuyến xe và vị trí điểm dừng.</p>
          </div>
          <button onClick={handleLogout} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
            Đăng xuất
          </button>
        </header>

        {stats && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Tổng tuyến', stats.routes],
              ['Đang hoạt động', stats.activeRoutes],
              ['Điểm dừng', stats.stops],
              ['Liên kết tuyến–trạm', stats.routeStops],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
          <button onClick={() => changeTab('routes')} className={`px-4 py-2.5 text-sm font-semibold ${tab === 'routes' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 dark:text-gray-400'}`}>Tuyến xe</button>
          <button onClick={() => changeTab('stops')} className={`px-4 py-2.5 text-sm font-semibold ${tab === 'stops' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 dark:text-gray-400'}`}>Điểm dừng</button>
        </div>

        {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">{notice}</p>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

        {tab === 'routes' ? (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <section className="max-h-[620px] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Danh sách tuyến</p>
                <button onClick={startNewRoute} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">+ Thêm tuyến</button>
              </div>
              <div className="space-y-1">
                {routes.map((route) => (
                  <button key={route._id} onClick={() => chooseRoute(route)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${selectedRoute?._id === route._id ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <span className="h-8 w-2 rounded-full" style={{ backgroundColor: route.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{route.name}</span>
                      <span className="text-xs text-gray-400">{route.startTime}–{route.endTime} · {route.frequency} phút</span>
                    </span>
                    <span className={`h-2 w-2 rounded-full ${route.status === 'active' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              {!routeForm ? (
                <div className="flex min-h-72 items-center justify-center text-sm text-gray-400">Chọn một tuyến xe để chỉnh sửa.</div>
              ) : (
                <form onSubmit={saveRoute} className="space-y-4">
                  <h3 className="font-bold text-gray-900 dark:text-white">{creatingRoute ? 'Thêm tuyến xe mới' : 'Chỉnh sửa tuyến xe'}</h3>
                  <div>
                    <label className={labelClass}>Tên tuyến</label>
                    <input className={inputClass} value={routeForm.name} onChange={(event) => setRouteForm({ ...routeForm, name: event.target.value })} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass}>Màu tuyến</label>
                      <div className="flex gap-2">
                        <input type="color" className="h-10 w-12 rounded border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800" value={routeForm.color} onChange={(event) => setRouteForm({ ...routeForm, color: event.target.value })} />
                        <input className={inputClass} value={routeForm.color} onChange={(event) => setRouteForm({ ...routeForm, color: event.target.value })} />
                      </div>
                    </div>
                    <div>
                      <label className={labelClass}>Trạng thái</label>
                      <select className={inputClass} value={routeForm.status} onChange={(event) => setRouteForm({ ...routeForm, status: event.target.value as RouteDraft['status'] })}>
                        <option value="active">Đang hoạt động</option>
                        <option value="inactive">Tạm ngưng</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={labelClass}>Giờ bắt đầu</label><input type="time" className={inputClass} value={routeForm.startTime} onChange={(event) => setRouteForm({ ...routeForm, startTime: event.target.value })} required /></div>
                    <div><label className={labelClass}>Giờ kết thúc</label><input type="time" className={inputClass} value={routeForm.endTime} onChange={(event) => setRouteForm({ ...routeForm, endTime: event.target.value })} required /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={labelClass}>Tần suất (phút)</label><input type="number" min="1" max="360" className={inputClass} value={routeForm.frequency} onChange={(event) => setRouteForm({ ...routeForm, frequency: event.target.value })} required /></div>
                    <div><label className={labelClass}>Giá vé (VNĐ)</label><input type="number" min="0" max="1000000" step="1000" className={inputClass} value={routeForm.price} onChange={(event) => setRouteForm({ ...routeForm, price: event.target.value })} required /></div>
                  </div>
                  <button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Đang lưu...' : creatingRoute ? 'Tạo tuyến xe' : 'Lưu thay đổi tuyến'}</button>
                </form>
              )}

              {selectedRoute && !creatingRoute && (
                <div className="mt-6 border-t border-gray-200 pt-5 dark:border-gray-700">
                  <div className="mb-4 flex justify-end">
                    <button
                      type="button"
                      disabled={saving || routeStopBusy}
                      onClick={deleteSelectedRoute}
                      className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >Xóa tuyến</button>
                  </div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white">Điểm dừng thuộc tuyến</h3>
                      <p className={`text-xs ${routeStopsDirty ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                        {routeStops.length} điểm · {routeStopsDirty ? 'có thay đổi chưa lưu' : 'dữ liệu đã được lưu'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {routeStopsLoading && <span className="text-xs text-blue-500">Đang tải...</span>}
                      <button
                        type="button"
                        disabled={routeStopBusy || !routeStopsDirty}
                        onClick={cancelRouteStopDraft}
                        className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                      >Hủy thay đổi</button>
                      <button
                        type="button"
                        disabled={routeStopBusy || !routeStopsDirty}
                        onClick={saveRouteStopDraft}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                      >{routeStopBusy ? 'Đang lưu...' : 'Lưu danh sách điểm dừng'}</button>
                    </div>
                  </div>

                  <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2 dark:border-gray-700">
                    {!routeStopsLoading && routeStops.length === 0 && (
                      <p className="px-3 py-6 text-center text-sm text-gray-400">Tuyến này chưa có điểm dừng.</p>
                    )}
                    {routeStops.map((routeStop, index) => (
                      <div
                        key={routeStop._id}
                        onDragOver={(event) => {
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDragOverRouteStopId(routeStop._id)
                        }}
                        onDragLeave={() => setDragOverRouteStopId(
                          (current) => current === routeStop._id ? null : current,
                        )}
                        onDrop={(event) => dropRouteStop(event, index)}
                        className={`flex items-center gap-2 rounded-lg px-2 py-2 transition ${
                          draggedRouteStopId === routeStop._id
                            ? 'opacity-40'
                            : dragOverRouteStopId === routeStop._id
                              ? 'bg-blue-50 ring-2 ring-blue-400 dark:bg-blue-900/30'
                              : 'bg-gray-50 dark:bg-gray-900/60'
                        }`}
                      >
                        <button
                          type="button"
                          draggable={!routeStopBusy}
                          onDragStart={(event) => startRouteStopDrag(event, routeStop._id)}
                          onDragEnd={endRouteStopDrag}
                          disabled={routeStopBusy}
                          title="Giữ và kéo để đổi vị trí"
                          aria-label={`Kéo để đổi vị trí ${routeStop.stopId.name}`}
                          className="flex h-7 w-7 flex-shrink-0 cursor-grab items-center justify-center rounded text-lg leading-none text-gray-400 hover:bg-white hover:text-blue-600 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-gray-700"
                        >⠿</button>
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">{routeStop.stopId.name}</span>
                          <span className="block truncate text-[11px] text-gray-400">
                            {routeStopsDirty
                              ? index === 0 ? 'Điểm đầu tuyến' : 'Khoảng cách sẽ tính lại khi lưu'
                              : index === 0 ? 'Điểm đầu tuyến' : `${routeStop.distanceFromPrev.toLocaleString('vi-VN')} m từ trạm trước`}
                          </span>
                        </span>
                        <button
                          type="button"
                          title="Gỡ khỏi tuyến"
                          disabled={routeStopBusy}
                          onClick={() => removeRouteStopLink(routeStop)}
                          className="h-7 w-7 rounded text-red-500 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-red-900/30"
                        >×</button>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-900/10">
                    <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_180px]">
                      <input
                        className={inputClass}
                        placeholder="Tìm điểm dừng để nối vào tuyến..."
                        value={candidateSearch}
                        onChange={(event) => setCandidateSearch(event.target.value)}
                      />
                      <select
                        className={inputClass}
                        value={insertPosition}
                        onChange={(event) => setInsertPosition(Number(event.target.value))}
                      >
                        {Array.from({ length: routeStops.length + 1 }, (_, position) => (
                          <option key={position} value={position}>
                            {position === routeStops.length ? 'Thêm cuối tuyến' : `Chèn trước trạm ${position + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {candidateStops.map((stop) => (
                        <div key={stop._id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 dark:bg-gray-800">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">{stop.name}</span>
                            <span className="block truncate text-[11px] text-gray-400">{stop.address || `${stop.lat}, ${stop.lng}`}</span>
                          </span>
                          <button
                            type="button"
                            disabled={routeStopBusy}
                            onClick={() => addRouteStop(stop._id)}
                            className="flex-shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Thêm vào bản nháp
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <section className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex gap-2">
                <input className={inputClass} placeholder="Tìm tên hoặc địa chỉ điểm dừng..." value={stopSearch} onChange={(event) => setStopSearch(event.target.value)} />
                <button onClick={startNewStop} className="flex-shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">+ Thêm</button>
              </div>
              <p className="px-2 py-2 text-xs text-gray-400">{stopMeta.total} điểm dừng</p>
              <div className="max-h-[520px] space-y-1 overflow-y-auto">
                {stops.map((stop) => (
                  <button key={stop._id} onClick={() => chooseStop(stop)} className={`w-full rounded-lg px-3 py-2.5 text-left transition ${selectedStop?._id === stop._id ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                    <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{stop.name}</span>
                    <span className="block truncate text-xs text-gray-400">{stop.address || `${stop.lat}, ${stop.lng}`}</span>
                  </button>
                ))}
              </div>
              {stopMeta.pages > 1 && (
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-xs dark:border-gray-700">
                  <button disabled={stopMeta.page <= 1} onClick={() => loadStops(stopSearch, stopMeta.page - 1)} className="rounded px-2 py-1 text-blue-600 disabled:text-gray-300">Trang trước</button>
                  <span className="text-gray-400">{stopMeta.page}/{stopMeta.pages}</span>
                  <button disabled={stopMeta.page >= stopMeta.pages} onClick={() => loadStops(stopSearch, stopMeta.page + 1)} className="rounded px-2 py-1 text-blue-600 disabled:text-gray-300">Trang sau</button>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
              {!stopForm ? (
                <div className="flex min-h-72 items-center justify-center text-sm text-gray-400">Chọn một điểm dừng để chỉnh sửa.</div>
              ) : (
                <form onSubmit={saveStop} className="space-y-4">
                  {!creatingStop && selectedStop && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={deleteSelectedStop}
                        className="rounded-lg border border-red-300 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                      >Xóa điểm dừng</button>
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-gray-900 dark:text-white">{creatingStop ? 'Thêm điểm dừng mới' : 'Chỉnh sửa điểm dừng'}</h3>
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      {creatingStop ? 'Điểm dừng mới chưa được tự động gắn vào tuyến xe.' : 'Thay đổi vị trí sẽ áp dụng cho mọi tuyến đi qua điểm dừng này.'}
                    </p>
                  </div>
                  <div><label className={labelClass}>Tên điểm dừng</label><input className={inputClass} value={stopForm.name} onChange={(event) => setStopForm({ ...stopForm, name: event.target.value })} required /></div>
                  <div><label className={labelClass}>Địa chỉ</label><input className={inputClass} value={stopForm.address} onChange={(event) => setStopForm({ ...stopForm, address: event.target.value })} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div><label className={labelClass}>Vĩ độ</label><input type="number" step="0.000001" className={inputClass} value={stopForm.lat} onChange={(event) => setStopForm({ ...stopForm, lat: event.target.value })} required /></div>
                    <div><label className={labelClass}>Kinh độ</label><input type="number" step="0.000001" className={inputClass} value={stopForm.lng} onChange={(event) => setStopForm({ ...stopForm, lng: event.target.value })} required /></div>
                  </div>
                  {validStopPosition && (
                    <>
                      <AdminLocationMap
                        lat={validStopPosition.lat}
                        lng={validStopPosition.lng}
                        onChange={(lat, lng) => setStopForm({ ...stopForm, lat: String(lat), lng: String(lng) })}
                      />
                      <p className="text-xs text-gray-400">Nhấp lên bản đồ để chọn vị trí mới.</p>
                    </>
                  )}
                  <button disabled={saving || !validStopPosition} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? 'Đang lưu...' : creatingStop ? 'Tạo điểm dừng' : 'Lưu điểm dừng'}</button>
                </form>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
