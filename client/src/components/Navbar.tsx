import { NavLink } from 'react-router-dom'

interface Props {
  dark: boolean
  onToggleDark: () => void
}

function Navbar({ dark, onToggleDark }: Props) {
  return (
    <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 md:px-6 h-14 md:h-16 flex items-center justify-between transition-colors">
      <div className="flex items-center gap-2 md:gap-3">
        <span className="text-xl md:text-2xl">🚌</span>
        <div>
          <h1 className="text-base md:text-lg font-bold text-gray-900 dark:text-white leading-none">TransitFlow</h1>
          <p className="hidden md:block text-xs text-gray-500 dark:text-gray-400">Dự báo thời gian xe buýt theo giao thông thực tế</p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`
          }
        >
          Tuyến xe
        </NavLink>
        <NavLink
          to="/journey"
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`
          }
        >
          <span className="sm:hidden">Tra cứu</span>
          <span className="hidden sm:inline">Tra cứu đường đi</span>
        </NavLink>
        <NavLink
          to="/admin"
          className={({ isActive }) =>
            `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive
                ? 'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`
          }
        >
          <span className="sm:hidden">⚙</span>
          <span className="hidden sm:inline">Quản trị</span>
        </NavLink>

        {/* Dark / Light toggle */}
        <button
          type="button"
          onClick={onToggleDark}
          aria-label={dark ? 'Chuyển sang light mode' : 'Chuyển sang dark mode'}
          className="ml-1 w-9 h-9 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {dark ? (
            /* Sun icon */
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="4" />
              <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            /* Moon icon */
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  )
}

export default Navbar
