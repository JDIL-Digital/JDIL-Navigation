import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useNotifications } from '../../context/NotificationContext'
import jindalLogo from '../../assets/Jindal_Logo.jpg'

const ICONS = {
  dashboard:   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />,
  doc:         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
  import:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  repair:      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />,
  ret:         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />,
  replacement: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
  truck:       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />,
  rig:         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />,
  admin:       <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></>,
}

const ALL = ['purchase', 'logistics', 'rig', 'admin', 'csuite']

// Flat list — order matters.
const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',       exact: true, icon: 'dashboard',   roles: ALL },
  { to: '/purchase',    label: 'Local Purchase',               icon: 'doc',         roles: ['purchase', 'admin', 'csuite'] },
  { label: 'Import Purchase', disabled: true,                  icon: 'import',      roles: ['purchase', 'admin', 'csuite'] },
  { to: '/repair',      label: 'Repair',                       icon: 'repair',      roles: ALL },
  { to: '/return',      label: 'Return',                       icon: 'ret',         roles: ALL },
  { to: '/replacement', label: 'Replacement',                  icon: 'replacement', roles: ALL },
  { to: '/logistics',   label: 'Logistics',                    icon: 'truck',       roles: ['logistics', 'admin', 'csuite'] },
  { to: '/rig',         label: 'Rig',                          icon: 'rig',         roles: ['rig', 'admin', 'csuite'] },
  { to: '/admin',       label: 'Admin',                        icon: 'admin',       roles: ['admin'] },
]

function Icon({ name }) {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">{ICONS[name]}</svg>
}

export default function Sidebar({ onNotificationsOpen, mobileOpen, onMobileClose }) {
  const { profile, signOut } = useAuth()
  const { dark, toggle } = useTheme()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()

  const visibleItems = NAV_ITEMS.filter(item => item.roles.includes(profile?.role))

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-800 flex flex-col items-center gap-1">
        <img src={jindalLogo} alt="Jindal Drilling & Industries Ltd." className="h-10 w-auto object-contain" />
        <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 tracking-wide">Material Tracking</p>
      </div>

      {/* Nav — flat */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map(item => (
          item.disabled ? (
            <div
              key={item.label}
              title="Coming soon"
              className="sidebar-link text-gray-300 dark:text-gray-600 cursor-not-allowed"
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              <span className="ml-auto text-[9px] uppercase tracking-wide bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">Soon</span>
            </div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={onMobileClose}
              className={({ isActive }) => `sidebar-link ${isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'}`}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          )
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="px-3 py-4 border-t border-gray-200 dark:border-gray-800 space-y-1">
        <button onClick={onNotificationsOpen} className="sidebar-link sidebar-link-inactive w-full relative">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span>Notifications</span>
          {unreadCount > 0 && (
            <span className="ml-auto bg-jdil-red text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        <button onClick={toggle} className="sidebar-link sidebar-link-inactive w-full">
          {dark ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
          )}
          <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
        </button>

        <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 mt-2">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{profile?.name}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{profile?.role}</p>
        </div>

        <button
          onClick={() => { signOut(); navigate('/login') }}
          className="sidebar-link w-full text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span>Logout</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      <aside className="hidden lg:flex flex-col w-56 shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 h-screen sticky top-0">
        {sidebarContent}
      </aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="fixed inset-0 bg-black/50" onClick={onMobileClose} />
          <aside className="relative flex flex-col w-56 bg-white dark:bg-gray-900 h-full z-50">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  )
}
