'use client'

/**
 * Chrome shared by every Platform Owner screen: the role gate, the section
 * navigation, and the global search box.
 *
 * The gate here is a convenience for the operator, not a security boundary —
 * every `/api/platform/*` route independently calls `requirePermission`, so a
 * user who reaches one of these pages by typing the URL still gets 403 from the
 * server and an empty screen. Rendering `AccessDenied` just makes that legible.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import {
  RiDashboardLine,
  RiBuildingLine,
  RiTeamLine,
  RiCoinLine,
  RiAlarmWarningLine,
  RiFileSearchLine,
  RiPulseLine,
  RiSearchLine,
  RiLoader4Line,
  RiCloseLine,
  RiShoppingBasketLine,
  RiShoppingCartLine,
  RiUserLine,
} from 'react-icons/ri'

const SECTIONS = [
  { href: '/platforma',             label: 'Përmbledhje',  icon: RiDashboardLine },
  { href: '/platforma/organizatat', label: 'Organizatat',  icon: RiBuildingLine },
  { href: '/platforma/perdoruesit', label: 'Përdoruesit',  icon: RiTeamLine },
  { href: '/platforma/abonimet',    label: 'Abonimet',     icon: RiCoinLine },
  { href: '/platforma/sinjalizime', label: 'Sinjalizime',  icon: RiAlarmWarningLine },
  { href: '/platforma/regjistri',   label: 'Auditimi',     icon: RiFileSearchLine },
  { href: '/platforma/sistemi',     label: 'Sistemi',      icon: RiPulseLine },
]

interface SearchResults {
  organizations: { id: number; name: string; isActive: boolean }[]
  users: { id: number; email: string; roli: string; organizationId: number; organizationName: string }[]
  staff: { id: number; emri: string; roli: string; organizationId: number; organizationName: string }[]
  products: {
    id: number; emri: string; kategoria: string; barcode: string | null
    organizationId: number; organizationName: string
  }[]
  sales: { id: number; totali: number; organizationId: number; organizationName: string }[]
  tooShort?: boolean
}

const EMPTY: SearchResults = { organizations: [], users: [], staff: [], products: [], sales: [] }

function GlobalSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY)
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Debounced so typing "market" issues one request, not six.
  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults(EMPTY)
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/platform/search?q=${encodeURIComponent(term)}`)
        if (!res.ok) throw new Error()
        setResults(await res.json())
      } catch {
        setResults(EMPTY)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const go = useCallback(
    (orgId: number) => {
      setOpen(false)
      setQuery('')
      router.push(`/platforma/organizatat/${orgId}`)
    },
    [router],
  )

  const total =
    results.organizations.length + results.users.length + results.staff.length +
    results.products.length + results.sales.length

  return (
    <div ref={boxRef} className="relative w-full sm:w-80">
      <div className="relative">
        <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Kërko market, përdorues, produkt, shitje #..."
          className="input w-full pl-9 pr-8 text-sm"
          aria-label="Kërkim global"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults(EMPTY) }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600"
            aria-label="Pastro kërkimin"
          >
            <RiCloseLine />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute z-40 mt-2 w-full sm:w-96 right-0 max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {searching ? (
            <div className="p-4 flex items-center gap-2 text-sm text-slate-500">
              <RiLoader4Line className="animate-spin" /> Duke kërkuar...
            </div>
          ) : total === 0 ? (
            <div className="p-4 text-sm text-slate-400">Asnjë rezultat për “{query.trim()}”</div>
          ) : (
            <div className="py-1">
              <SearchGroup title="Organizata" icon={RiBuildingLine}>
                {results.organizations.map((o) => (
                  <SearchRow key={`o-${o.id}`} onClick={() => go(o.id)}
                    primary={o.name} secondary={`#${o.id}${o.isActive ? '' : ' · pezulluar'}`} />
                ))}
              </SearchGroup>
              <SearchGroup title="Përdorues" icon={RiUserLine}>
                {results.users.map((u) => (
                  <SearchRow key={`u-${u.id}`} onClick={() => go(u.organizationId)}
                    primary={u.email} secondary={`${u.roli} · ${u.organizationName}`} />
                ))}
              </SearchGroup>
              <SearchGroup title="Staf (PIN)" icon={RiTeamLine}>
                {results.staff.map((s) => (
                  <SearchRow key={`s-${s.id}`} onClick={() => go(s.organizationId)}
                    primary={s.emri} secondary={`${s.roli} · ${s.organizationName}`} />
                ))}
              </SearchGroup>
              <SearchGroup title="Produkte" icon={RiShoppingBasketLine}>
                {results.products.map((p) => (
                  <SearchRow key={`p-${p.id}`} onClick={() => go(p.organizationId)}
                    primary={p.emri}
                    secondary={`${p.barcode ? `${p.barcode} · ` : ''}${p.kategoria} · ${p.organizationName}`} />
                ))}
              </SearchGroup>
              <SearchGroup title="Shitje" icon={RiShoppingCartLine}>
                {results.sales.map((s) => (
                  <SearchRow key={`sa-${s.id}`} onClick={() => go(s.organizationId)}
                    primary={`Shitje #${s.id} — ${s.totali.toLocaleString('sq-AL')} L`}
                    secondary={s.organizationName} />
                ))}
              </SearchGroup>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SearchGroup({
  title, icon: Icon, children,
}: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  if (items.filter(Boolean).length === 0) return null
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        <Icon className="text-xs" />
        {title}
      </div>
      {children}
    </div>
  )
}

function SearchRow({
  primary, secondary, onClick,
}: { primary: string; secondary: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
    >
      <p className="text-sm text-slate-800 truncate">{primary}</p>
      <p className="text-xs text-slate-400 truncate">{secondary}</p>
    </button>
  )
}

export default function PlatformShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  // `role` is resolved server-side and handed to the provider by the layout, so
  // it is authoritative on first render — there is no loading state to wait on.
  const { role } = useRole()
  const pathname = usePathname()

  if (role !== 'platform_owner') return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
          <GlobalSearch />
          {action}
        </div>
      </div>

      {/* Section nav. Scrolls horizontally on narrow screens rather than
          wrapping into a tall block that pushes the content off-screen. */}
      <nav className="mb-6 border-b border-slate-200 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {SECTIONS.map(({ href, label, icon: Icon }) => {
            const active =
              href === '/platforma' ? pathname === '/platforma' : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  active
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-200'
                }`}
              >
                <Icon className="text-base" />
                {label}
              </Link>
            )
          })}
        </div>
      </nav>

      {children}
    </div>
  )
}
