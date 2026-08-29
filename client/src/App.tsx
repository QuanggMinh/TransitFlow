import { Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import JourneyPage from './pages/JourneyPage'
import AdminPage from './pages/AdminPage'
import Navbar from './components/Navbar'
import { useDarkMode } from './hooks/useDarkMode'

function App() {
  const { dark, toggle } = useDarkMode()
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900 transition-colors">
      <Navbar dark={dark} onToggleDark={toggle} />
      <div className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/journey" element={<JourneyPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default App
