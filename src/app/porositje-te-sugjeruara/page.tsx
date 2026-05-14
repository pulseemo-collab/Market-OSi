'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency } from '@/lib/utils'
import {
  RiRefreshLine,
  RiFileListLine,
  RiTruckLine,
  RiAddLine,
  RiSubtractLine,
  RiCloseLine,
  RiCheckLine,
} from 'react-icons/ri'

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

function getTodayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtQty(sasia: number, njesia: string) {
  return isWeighted(njesia) ? sasia.toFixed(3) : String(sasia)
}

interface ProductSuggestion {
  id: number
  emri: string
  kategoria: string
  sasia: number
  stokuMinimal: number
  njesia: string
  cmimiBlerjes: number
  sasiaSugjeruar: number
}

interface SupplierGroup {
  furnitorId: number | null
  furnitorEmri: string
  products: ProductSuggestion[]
}

interface Supplier {
  id: number
  emri: string
}

interface SupplyItemForm {
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
}

export default function PorositjeTeSugjeruaraPage() {
  const { role } = useRole()
  const [groups, setGroups] = useState<SupplierGroup[]>([])
  const [totalProducts, setTotalProducts] = useState(0)
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [modalFurnitorId, setModalFurnitorId] = useState('')
  const [modalDate, setModalDate] = useState(getTodayString())
  const [modalShenime, setModalShenime] = useState('')
  const [modalItems, setModalItems] = useState<SupplyItemForm[]>([])
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reorder-suggestions')
      const data = await res.json()
      setGroups(data.groups ?? [])
      setTotalProducts(data.totalProducts ?? 0)
    } catch {
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then((data) => {
        const arr = Array.isArray(data) ? data : (data.suppliers ?? [])
        setSuppliers(arr)
      })
      .catch(() => {})
  }, [fetchData])

  const openModalForGroup = (group: SupplierGroup) => {
    setModalFurnitorId(group.furnitorId != null ? String(group.furnitorId) : '')
    setModalDate(getTodayString())
    setModalShenime('')
    setModalItems(
      group.products.map((p) => ({
        productId: p.id,
        emriProduktit: p.emri,
        sasia: p.sasiaSugjeruar,
        njesia: p.njesia,
        cmimiBlerjes: p.cmimiBlerjes,
      }))
    )
    setShowModal(true)
  }

  const openModalForAll = () => {
    setModalFurnitorId('')
    setModalDate(getTodayString())
    setModalShenime('')
    setModalItems(
      groups.flatMap((g) =>
        g.products.map((p) => ({
          productId: p.id,
          emriProduktit: p.emri,
          sasia: p.sasiaSugjeruar,
          njesia: p.njesia,
          cmimiBlerjes: p.cmimiBlerjes,
        }))
      )
    )
    setShowModal(true)
  }

  const updateQty = (idx: number, value: number) => {
    setModalItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const min = isWeighted(item.njesia) ? 0.001 : 1
        return { ...item, sasia: Math.max(min, value) }
      })
    )
  }

  const removeItem = (idx: number) => {
    setModalItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const handleSave = async () => {
    if (modalItems.length === 0) {
      toast.error('Nuk ka produkte')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          furnitorId: modalFurnitorId ? parseInt(modalFurnitorId) : null,
          data: modalDate || getTodayString(),
          shenime: modalShenime || null,
          items: modalItems.map((item) => ({
            productId: item.productId,
            emriProduktit: item.emriProduktit,
            sasia: item.sasia,
            njesia: item.njesia,
            cmimiBlerjes: item.cmimiBlerjes,
            updatePrice: false,
          })),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Gabim gjatë ruajtjes')
        return
      }
      toast.success('Furnizimi u krijua me sukses')
      setShowModal(false)
      fetchData()
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  const modalTotal = modalItems.reduce((sum, item) => sum + item.sasia * item.cmimiBlerjes, 0)
  const suppliersWithId = groups.filter((g) => g.furnitorId !== null).length

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Porositje të Sugjeruara"
        subtitle={`${totalProducts} produkte kanë nevojë për porosi`}
        action={
          <button
            onClick={fetchData}
            className="btn-secondary flex items-center gap-2"
          >
            <RiRefreshLine />
            Rifresko
          </button>
        }
      />

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
          <div className="card p-3 sm:p-4 border-l-4 border-orange-400">
            <p className="text-xs font-medium text-slate-500 mb-1">Produkte për Porosi</p>
            <p className="text-xl sm:text-2xl font-bold text-orange-600">{totalProducts}</p>
          </div>
          <div className="card p-3 sm:p-4 border-l-4 border-blue-500">
            <p className="text-xs font-medium text-slate-500 mb-1">Furnitorë</p>
            <p className="text-xl sm:text-2xl font-bold text-blue-600">{suppliersWithId}</p>
          </div>
          {totalProducts > 0 && (
            <div className="card p-3 sm:p-4 col-span-2 sm:col-span-1 flex flex-col justify-between">
              <p className="text-xs font-medium text-slate-500 mb-2">Krijo furnizim të plotë</p>
              <button
                onClick={openModalForAll}
                className="btn-primary text-sm flex items-center justify-center gap-2"
              >
                <RiFileListLine />
                Krijo nga Sugjerimet
              </button>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-5 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-slate-200 rounded-lg" />
                  <div className="h-4 bg-slate-200 rounded w-40" />
                </div>
                <div className="h-9 bg-slate-200 rounded-lg w-32" />
              </div>
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="flex gap-6">
                    <div className="h-4 bg-slate-100 rounded w-40" />
                    <div className="h-4 bg-slate-100 rounded w-16" />
                    <div className="h-4 bg-slate-100 rounded w-16" />
                    <div className="h-4 bg-slate-100 rounded w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="card p-12 text-center">
          <RiCheckLine className="text-4xl text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">Stoku është i mirë!</h3>
          <p className="text-sm text-slate-400">Të gjitha produktet janë mbi nivelin minimal</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group, gIdx) => (
            <motion.div
              key={group.furnitorId ?? '__none__'}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: gIdx * 0.07 }}
              className="card overflow-hidden"
            >
              {/* Group header */}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <RiTruckLine className="text-blue-500 text-base" />
                  </div>
                  <div>
                    <span className="font-semibold text-slate-900">
                      Furnitori: {group.furnitorEmri}
                    </span>
                    <span className="ml-2 badge-blue">{group.products.length} produkte</span>
                  </div>
                </div>
                <button
                  onClick={() => openModalForGroup(group)}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <RiFileListLine />
                  Krijo Furnizim
                </button>
              </div>

              {/* Products table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="table-th">Produkti</th>
                      <th className="table-th text-center">Stok Aktual</th>
                      <th className="table-th text-center">Stok Minimal</th>
                      <th className="table-th text-center">Porosit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.products.map((p, pIdx) => (
                      <motion.tr
                        key={p.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: gIdx * 0.07 + pIdx * 0.03 }}
                        className={`table-row ${p.sasia === 0 ? 'bg-red-50' : ''}`}
                      >
                        <td className="table-td">
                          <p className="font-medium text-slate-900">{p.emri}</p>
                          <p className="text-xs text-slate-400">{p.kategoria}</p>
                        </td>
                        <td className="table-td text-center">
                          <span
                            className={`font-bold text-base ${
                              p.sasia === 0 ? 'text-red-600' : 'text-orange-500'
                            }`}
                          >
                            {fmtQty(p.sasia, p.njesia)}
                          </span>
                          <span className="text-xs text-slate-400 ml-1">{p.njesia}</span>
                        </td>
                        <td className="table-td text-center text-slate-500">
                          {fmtQty(p.stokuMinimal, p.njesia)}{' '}
                          <span className="text-xs text-slate-400">{p.njesia}</span>
                        </td>
                        <td className="table-td text-center">
                          <span className="badge-blue font-semibold">
                            {fmtQty(p.sasiaSugjeruar, p.njesia)} {p.njesia}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-2.5 border-t border-slate-100 bg-slate-50">
                <p className="text-xs text-slate-400">
                  Formula: max(stokuMinimal × 2 − stoku aktual, stokuMinimal)
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Supply Creation Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => !saving && setShowModal(false)}
        title="Krijo Furnizim nga Sugjerimet"
        size="xl"
      >
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="label">Furnitori</label>
              <select
                value={modalFurnitorId}
                onChange={(e) => setModalFurnitorId(e.target.value)}
                className="input"
              >
                <option value="">Pa furnitor</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emri}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Data e Furnizimit</label>
              <input
                type="date"
                value={modalDate}
                onChange={(e) => setModalDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="mb-5">
            <label className="label">Shënime</label>
            <textarea
              value={modalShenime}
              onChange={(e) => setModalShenime(e.target.value)}
              placeholder="Shënime opsionale..."
              rows={2}
              className="input resize-none"
            />
          </div>

          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Produkte ({modalItems.length})
          </p>

          {modalItems.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl mb-3">
              Nuk ka produkte. Të gjitha artikujt u hoqën.
            </div>
          ) : (
            <div className="space-y-2 mb-3 max-h-72 overflow-y-auto pr-1">
              {modalItems.map((item, idx) => (
                <div
                  key={`${item.productId}-${idx}`}
                  className="p-3 bg-slate-50 rounded-xl"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-sm font-medium text-slate-900 truncate flex-1">
                      {item.emriProduktit}
                    </p>
                    <button
                      onClick={() => removeItem(idx)}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <RiCloseLine className="text-base" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() =>
                        updateQty(idx, item.sasia - (isWeighted(item.njesia) ? 0.1 : 1))
                      }
                      className="w-8 h-8 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                    >
                      <RiSubtractLine className="text-xs" />
                    </button>
                    <input
                      type="number"
                      value={item.sasia}
                      min={isWeighted(item.njesia) ? 0.001 : 1}
                      step={isWeighted(item.njesia) ? 0.1 : 1}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value)
                        if (!isNaN(val)) updateQty(idx, val)
                      }}
                      className="w-20 text-center text-sm border border-slate-200 rounded py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={() =>
                        updateQty(idx, item.sasia + (isWeighted(item.njesia) ? 0.1 : 1))
                      }
                      className="w-8 h-8 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                    >
                      <RiAddLine className="text-xs" />
                    </button>
                    <span className="text-xs text-slate-400 w-10">{item.njesia}</span>
                    <span className="text-sm font-semibold text-slate-900 ml-auto">
                      {formatCurrency(item.sasia * item.cmimiBlerjes)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-slate-50 rounded-xl p-4 mb-5">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-slate-500">Totali i Furnizimit</span>
              <span className="font-bold text-slate-900 text-lg">{formatCurrency(modalTotal)}</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">{modalItems.length} produkte</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowModal(false)}
              disabled={saving}
              className="btn-secondary flex-1"
            >
              Anulo
            </button>
            <button
              onClick={handleSave}
              disabled={saving || modalItems.length === 0}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? 'Duke ruajtur...' : 'Ruaj Furnizimin'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
