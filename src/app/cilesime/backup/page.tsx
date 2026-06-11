'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import toast from 'react-hot-toast'
import {
  RiDownload2Line,
  RiUpload2Line,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiAlertLine,
  RiShieldCheckLine,
  RiFileTextLine,
  RiRefreshLine,
  RiCheckLine,
  RiArrowLeftLine,
  RiSave3Line,
} from 'react-icons/ri'

interface BackupMetadata {
  appVersion: string
  organizationId: number
  organizationName: string
  exportedAt: string
  exportedBy: string
  counts: {
    suppliers: number
    products: number
    productBarcodes: number
    supplies: number
    supplyItems: number
    sales: number
    saleItems: number
    userRoles: number
    auditLogs: number
  }
}

interface ParsedBackup {
  metadata: BackupMetadata
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

interface RestoreResult {
  suppliers: number
  products: number
  productBarcodes: number
  supplies: number
  supplyItems: number
  sales: number
  saleItems: number
}

const COUNT_LABELS: Array<{ key: keyof BackupMetadata['counts']; label: string }> = [
  { key: 'suppliers', label: 'Furnitorë' },
  { key: 'products', label: 'Produkte' },
  { key: 'productBarcodes', label: 'Barkode' },
  { key: 'supplies', label: 'Furnizime' },
  { key: 'supplyItems', label: 'Artikuj Furnizimi' },
  { key: 'sales', label: 'Shitje' },
  { key: 'saleItems', label: 'Artikuj Shitjesh' },
  { key: 'userRoles', label: 'Përdorues' },
  { key: 'auditLogs', label: 'Regjistrime Auditimi' },
]

function validateBackupShape(data: unknown): data is ParsedBackup {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  if (!d.metadata || typeof d.metadata !== 'object') return false
  const meta = d.metadata as Record<string, unknown>
  if (typeof meta.appVersion !== 'string') return false
  if (typeof meta.organizationId !== 'number') return false
  if (typeof meta.organizationName !== 'string') return false
  if (typeof meta.exportedAt !== 'string') return false
  if (typeof meta.exportedBy !== 'string') return false
  const required = ['suppliers', 'products', 'productBarcodes', 'supplies', 'supplyItems', 'sales', 'saleItems', 'userRoles', 'auditLogs']
  for (const key of required) {
    if (!Array.isArray(d[key])) return false
  }
  return true
}

export default function CilesimiBackupPage() {
  const { role } = useRole()
  const subscription = useSubscription()

  const [exporting, setExporting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsedBackup, setParsedBackup] = useState<ParsedBackup | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [crossOrgWarning, setCrossOrgWarning] = useState<{ orgName: string; orgId: number } | null>(null)
  const [crossOrgConfirmed, setCrossOrgConfirmed] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null)

  if (!role || role !== 'owner') return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const handleDownload = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/backup')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Gabim')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'market-osi-backup.json'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Backup u shkarkua me sukses!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gabim i panjohur'
      toast.error(`Gabim: ${msg}`)
    } finally {
      setExporting(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.json')) {
      setFileError('Ju lutem zgjidhni një skedar .json')
      setParsedBackup(null)
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string)
        if (!validateBackupShape(parsed)) {
          setFileError('Skedari i backup-it është i pavlefshëm ose i dëmtuar')
          setParsedBackup(null)
          return
        }
        setParsedBackup(parsed)
        setFileError(null)
        setConfirmed(false)
        setCrossOrgWarning(null)
        setCrossOrgConfirmed(false)
        setRestoreResult(null)
      } catch {
        setFileError('Skedari nuk mund të lexohet si JSON')
        setParsedBackup(null)
      }
    }
    reader.readAsText(file)
  }

  const handleRestore = async () => {
    if (!parsedBackup || !confirmed) return
    setRestoring(true)
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backup: parsedBackup, confirmCrossOrg: crossOrgConfirmed }),
      })

      const data = await res.json()

      if (res.status === 409 && data.crossOrgWarning) {
        setCrossOrgWarning({ orgName: data.backupOrgName, orgId: data.backupOrgId })
        setRestoring(false)
        return
      }

      if (!res.ok) throw new Error(data.error || 'Gabim gjatë rikuperimit')

      setRestoreResult(data.counts)
      toast.success('Rikuperimi u krye me sukses!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gabim i panjohur'
      toast.error(`Gabim: ${msg}`)
    } finally {
      setRestoring(false)
    }
  }

  const resetRestore = () => {
    setParsedBackup(null)
    setFileError(null)
    setConfirmed(false)
    setCrossOrgWarning(null)
    setCrossOrgConfirmed(false)
    setRestoreResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const canRestore = !!parsedBackup && confirmed && (!crossOrgWarning || crossOrgConfirmed)

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Back link */}
      <Link
        href="/cilesime"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-5 transition-colors"
      >
        <RiArrowLeftLine className="text-base" />
        Cilësimet
      </Link>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
          <RiSave3Line className="text-emerald-600 text-xl" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Backup & Rikuperim</h1>
          <p className="text-sm text-slate-500">Eksportoni dhe rikuperoni të dhënat e organizatës në mënyrë të sigurt</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Export Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="card p-6"
        >
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <RiShieldCheckLine className="text-blue-600 text-xl" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Shkarko Backup</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Eksportoni të gjitha të dhënat e organizatës në një skedar JSON.
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2 text-sm text-slate-600">
            <p className="flex items-center gap-2">
              <RiCheckboxCircleLine className="text-emerald-500 text-base flex-shrink-0" />
              Organizata, Produktet, Furnitorët
            </p>
            <p className="flex items-center gap-2">
              <RiCheckboxCircleLine className="text-emerald-500 text-base flex-shrink-0" />
              Furnizime, Shitje dhe artikujt e tyre
            </p>
            <p className="flex items-center gap-2">
              <RiCheckboxCircleLine className="text-emerald-500 text-base flex-shrink-0" />
              Rolet e përdoruesve dhe regjistrat e auditimit
            </p>
            <p className="flex items-center gap-2">
              <RiFileTextLine className="text-slate-400 text-base flex-shrink-0" />
              Format: <span className="font-mono text-xs bg-slate-200 px-1.5 py-0.5 rounded">market-osi-backup-{'{org}'}-{'{YYYY-MM-DD}'}.json</span>
            </p>
          </div>

          <button
            onClick={handleDownload}
            disabled={exporting}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {exporting ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <RiDownload2Line className="text-lg" />
            )}
            {exporting ? 'Duke eksportuar...' : 'Shkarko Backup'}
          </button>
        </motion.div>

        {/* Restore Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="card p-6"
        >
          <div className="flex items-start gap-4 mb-5">
            <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <RiUpload2Line className="text-amber-600 text-xl" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">Rikuperim nga Backup</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Ngarkoni një skedar backup-i për të rikuperuar të dhënat.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-5">
            <RiErrorWarningLine className="text-red-500 text-base flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 leading-relaxed">
              <span className="font-semibold">KUJDES:</span> Rikuperimi do të fshijë dhe zëvendësojë
              të gjitha të dhënat aktuale të organizatës (produkte, shitje, furnizime, furnitorë).
              Ky veprim nuk mund të kthehet mbrapsht.
            </p>
          </div>

          <AnimatePresence>
            {restoreResult && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <RiCheckboxCircleLine className="text-emerald-500 text-lg" />
                  <span className="text-sm font-semibold text-emerald-700">Rikuperimi u krye me sukses!</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs text-emerald-700">
                  <span>Furnitorë: <strong>{restoreResult.suppliers}</strong></span>
                  <span>Produkte: <strong>{restoreResult.products}</strong></span>
                  <span>Barkode: <strong>{restoreResult.productBarcodes}</strong></span>
                  <span>Furnizime: <strong>{restoreResult.supplies}</strong></span>
                  <span>Shitje: <strong>{restoreResult.sales}</strong></span>
                  <span>Artikuj Shitjesh: <strong>{restoreResult.saleItems}</strong></span>
                </div>
                <button onClick={resetRestore} className="btn-secondary mt-3 text-xs py-1.5 px-3">
                  <RiRefreshLine className="inline mr-1" />
                  Rikuperim i ri
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {!restoreResult && (
            <>
              <div className="mb-4">
                <label className="label">Skedari i Backup-it (.json)</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-slate-200 rounded-lg p-1.5"
                />
                {fileError && (
                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                    <RiAlertLine className="flex-shrink-0" />{fileError}
                  </p>
                )}
              </div>

              <AnimatePresence>
                {parsedBackup && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4"
                  >
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                      Informacion Backup-it
                    </p>
                    <div className="space-y-1.5 text-sm mb-3">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Organizata:</span>
                        <span className="font-semibold text-slate-800">{parsedBackup.metadata.organizationName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Eksportuar më:</span>
                        <span className="text-slate-700">{new Date(parsedBackup.metadata.exportedAt).toLocaleString('sq-AL')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Eksportuar nga:</span>
                        <span className="text-slate-700 text-xs truncate max-w-[160px]">{parsedBackup.metadata.exportedBy}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Versioni:</span>
                        <span className="font-mono text-xs text-slate-600">{parsedBackup.metadata.appVersion}</span>
                      </div>
                    </div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Numri i të Dhënave
                    </p>
                    <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
                      {COUNT_LABELS.map(({ key, label }) => (
                        <span key={key}>
                          {label}: <strong className="text-slate-800">{parsedBackup.metadata.counts[key] ?? 0}</strong>
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {crossOrgWarning && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4"
                  >
                    <div className="flex items-start gap-2">
                      <RiAlertLine className="text-amber-500 text-base flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-800 mb-1">Backup nga organizatë tjetër</p>
                        <p className="text-xs text-amber-700 leading-relaxed mb-3">
                          Ky backup i përket organizatës <strong>"{crossOrgWarning.orgName}"</strong> (ID: {crossOrgWarning.orgId}),
                          jo organizatës suaj aktuale. Konfirmoni nëse dëshironi të vazhdoni.
                        </p>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={crossOrgConfirmed}
                            onChange={(e) => setCrossOrgConfirmed(e.target.checked)}
                            className="mt-0.5 rounded border-amber-300 text-amber-600"
                          />
                          <span className="text-xs text-amber-800 font-medium">
                            Konfirmoj importin nga organizatë tjetër
                          </span>
                        </label>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {parsedBackup && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span className="text-sm text-slate-700 group-hover:text-slate-900 leading-relaxed">
                      Konfirmoj se dua të <span className="font-semibold text-red-600">zëvendësoj të gjitha të dhënat aktuale</span> me
                      të dhënat nga ky backup. Ky veprim nuk mund të kthehet.
                    </span>
                  </label>
                </motion.div>
              )}

              {parsedBackup && (
                <button
                  onClick={handleRestore}
                  disabled={!canRestore || restoring}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-150 bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                >
                  {restoring ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <RiCheckLine className="text-lg" />
                  )}
                  {restoring ? 'Duke rikuperuar...' : 'Rikupero të Dhënat'}
                </button>
              )}
            </>
          )}
        </motion.div>
      </div>
    </div>
  )
}
