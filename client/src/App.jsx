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
import AuthCallback from './pages/AuthCallback'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ReverseLogisticsPage from './pages/ReverseLogisticsPage'
import ReverseLogisticsCombinedPage from './pages/ReverseLogisticsCombinedPage'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading, profileLoading } = useAuth()
  // Only block on the INITIAL profile load (when we don't yet have a profile).
  // A background re-fetch — e.g. Supabase refreshing the token when the tab
  // regains focus — must NOT replace the page with a spinner, or it would
  // unmount the whole app subtree and lose transient UI state like an open
  // "New PO" panel. Once we have a profile, keep rendering during re-fetches.
  if (loading || (profileLoading && !!user && !profile)) return <div className="flex items-center justify-center h-screen"><Spinner /></div>
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

      {/* Magic-link landing — always renders (no auth-state redirect) so it can
          confirm the session and self-close the tab. */}
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Public password-reset flow */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

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

        {/* Reverse Logistics — Repair / Return / Replacement */}
        <Route path="repair" element={
          <ProtectedRoute allowedRoles={['purchase', 'logistics', 'rig', 'admin', 'csuite']}>
            <ReverseLogisticsPage jobType="Repair" />
          </ProtectedRoute>
        } />
        <Route path="return" element={
          <ProtectedRoute allowedRoles={['purchase', 'logistics', 'rig', 'admin', 'csuite']}>
            <ReverseLogisticsPage jobType="Return" />
          </ProtectedRoute>
        } />
        <Route path="replacement" element={
          <ProtectedRoute allowedRoles={['purchase', 'logistics', 'rig', 'admin', 'csuite']}>
            <ReverseLogisticsPage jobType="Replacement" />
          </ProtectedRoute>
        } />
        <Route path="reverse-logistics" element={
          <ProtectedRoute allowedRoles={['purchase', 'logistics', 'rig', 'admin', 'csuite']}>
            <ReverseLogisticsCombinedPage />
          </ProtectedRoute>
        } />
      </Route>

      {/* Unknown paths → send unauthenticated users to login, authenticated to home */}
      <Route path="*" element={<Navigate to="/login" replace />} />
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
