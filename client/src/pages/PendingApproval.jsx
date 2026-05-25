import { Link } from 'react-router-dom'
import JDILLogo from '../components/ui/JDILLogo'
import { useAuth } from '../context/AuthContext'

export default function PendingApproval() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 max-w-md w-full text-center">
        <JDILLogo size="md" />
        <div className="w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center mx-auto mt-6 mb-4">
          <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Account Pending Approval</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Your registration has been submitted. An administrator needs to approve your account before you can access the system.
        </p>
        <button onClick={signOut} className="btn-secondary w-full">Sign Out</button>
      </div>
    </div>
  )
}
