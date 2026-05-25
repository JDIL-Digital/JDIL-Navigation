import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { NotificationProvider } from './context/NotificationContext'
import Layout from './components/layout/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import PendingApproval from './pages/PendingApproval'
import Dashboard from './pages/Dashboard'
import PurchaseOrders from './pages/PurchaseOrders'
import LogisticsPage from './pages/LogisticsPage'
import RigPage from './pages/RigPage'
import AdminPage from './pages/AdminPage'
import AdminLoginPage from './pages/AdminLoginPage'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading, profileLoading } = useAuth()
  if (loading || profileLoading) return <div className="flex items-center justify-center h-screen"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  if (!profile?.is_active) return <Navigate to="/pending" replace />
  if (allowedRoles && !allowedRoles.includes(profile?.role)) return <Navigate to="/" replace />
  return children
}

function Spinner() {
  return (
    <div className="w-10 h-10 border-4 border-jdil-green border-t-transparent rounded-full animate-spin" />
  )
}

function AppRoutes() {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-950">
        <Spinner />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={!user ? <LoginPage /> : <Navigate to="/" replace />} />
      <Route path="/admin-login" element={!user ? <AdminLoginPage /> : <Navigate to="/admin" replace />} />
      <Route path="/register" element={!user ? <RegisterPage /> : <Navigate to="/" replace />} />
      <Route path="/pending" element={<PendingApproval />} />

      <Route path="/" element={
        <ProtectedRoute>
          <NotificationProvider>
            <Layout />
          </NotificationProvider>
        </ProtectedRoute>
      }>
        <Route index element={<Dashboard />} />
        <Route path="purchase" element={
          <ProtectedRoute allowedRoles={['purchase', 'admin', 'csuite']}>
            <PurchaseOrders />
          </ProtectedRoute>
        } />
        <Route path="logistics" element={
          <ProtectedRoute allowedRoles={['logistics', 'admin', 'csuite']}>
            <LogisticsPage />
          </ProtectedRoute>
        } />
        <Route path="rig" element={
          <ProtectedRoute allowedRoles={['rig', 'admin', 'csuite']}>
            <RigPage />
          </ProtectedRoute>
        } />
        <Route path="admin" element={
          <ProtectedRoute allowedRoles={['admin']}>
            <AdminPage />
          </ProtectedRoute>
        } />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
