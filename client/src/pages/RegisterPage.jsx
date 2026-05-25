import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import JDILLogo from '../components/ui/JDILLogo'
import { BUYER_CODES, LOGISTICS_CODES, PO_RIG_OPTIONS } from '../utils/constants'
import { isAllowedEmail, DOMAIN_ERROR } from '../utils/authValidation'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    role: '', teamCode: '', rigName: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  const teamCodes = form.role === 'purchase' ? BUYER_CODES : form.role === 'logistics' ? LOGISTICS_CODES : []

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!isAllowedEmail(form.email)) {
      setError(DOMAIN_ERROR)
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    const { error: err } = await register(form)
    setLoading(false)
    if (err) setError(err.message)
    else setSuccess(true)
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Registration Submitted</h2>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Your account is pending admin approval. You'll be notified once it's activated.
          </p>
          <Link to="/login" className="btn-primary inline-block">Back to Login</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-800 p-8">
          <div className="flex flex-col items-center mb-6">
            <JDILLogo size="md" />
            <p className="mt-2 text-sm font-medium text-gray-600 dark:text-gray-400">Create Account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input type="text" className="input-field" placeholder="John Smith" required
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>

            <div>
              <label className="label">Email Address</label>
              <input type="email" className="input-field" placeholder="you@jindalmumbai.com" required
                value={form.email} onChange={e => set('email', e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Password</label>
                <input type="password" className="input-field" placeholder="Min. 6 chars" required
                  value={form.password} onChange={e => set('password', e.target.value)} />
              </div>
              <div>
                <label className="label">Confirm Password</label>
                <input type="password" className="input-field" placeholder="Repeat" required
                  value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Role</label>
              <select className="input-field" required value={form.role} onChange={e => set('role', e.target.value)}>
                <option value="">Select role…</option>
                <option value="purchase">Purchase</option>
                <option value="logistics">Logistics</option>
                <option value="rig">Rig</option>
                <option value="csuite">C-Suite</option>
              </select>
            </div>

            {teamCodes.length > 0 && (
              <div>
                <label className="label">Team Code</label>
                <select className="input-field" value={form.teamCode} onChange={e => set('teamCode', e.target.value)}>
                  <option value="">Select code…</option>
                  {teamCodes.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}

            {form.role === 'rig' && (
              <div>
                <label className="label">Assigned Rig</label>
                <select className="input-field" value={form.rigName} onChange={e => set('rigName', e.target.value)}>
                  <option value="">Select rig…</option>
                  {PO_RIG_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            )}

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 disabled:opacity-60">
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {loading ? 'Submitting…' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-jdil-green hover:text-jdil-green-dark font-medium">Sign In</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
