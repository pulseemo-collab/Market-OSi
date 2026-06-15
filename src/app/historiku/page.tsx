'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import ExportButtons from '@/components/ui/ExportButtons'
import { formatCurrency, formatDateTime, toArray } from '@/lib/utils'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiReceiptLine,
  RiArrowDownLine,
  RiDeleteBin6Line,
  RiEditLine,
  RiAddLine,
  RiSubtractLine,
  RiCloseLine,
} from 'react-icons/ri'

interface SaleItem {
  id: number
  productId: number
  emriProduktit: string
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  fitimi: number
  product: {
    id: number
    sasia: number
    njesia: string
  } | null
}

interface Sale {
  id: number
  totali: number
  fitimi: number
  shenime: string | null
  paymentMethod: string
  createdAt: string
  items: SaleItem[]
}

interface Product {
  id: number
  emri: string
  kategoria: string
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  njesia: string
  barcodes: { barcode: string }[]
}

interface EditItem {
  productId: number
  emriProduktit: string
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  njesia: string
  availableStock: number
}

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

const PERIUDHAT = [
  { value: 'sot',       label: 'Sot' },
  { value: 'dje',       label: 'Dje' },
  { value: 'jave',      label: 'Këtë javë' },
  { value: 'muaj',      label: 'Këtë muaj' },
  { value: 'te-gjitha', label: 'Të gjitha' },
]

interface StaffSession {
  staffId: number
  staffName: string
  staffRole: string
}

export default function HistorikuPage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const [staffSession, setStaffSession] = useState<StaffSession | null>(null)
  const [staffSessionLoading, setStaffSessionLoading] = useState(true)
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [periudha, setPeriudha] = useState('sot')
  const [dataFiltri, setDataFiltri] = useState('')
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Edit state
  const [saleToEdit, setSaleToEdit] = useState<Sale | null>(null)
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editSaving, setEditSaving] = useState(false)
  const [allProducts, setAllProducts] = useState<Product[]>([])
  const [addProductSearch, setAddProductSearch] = useState('')
  const [showAddProduct, setShowAddProduct] = useState(false)

  useEffect(() => {
    fetch('/api/staff-auth/session')
      .then((r) => r.json())
      .then((data) => setStaffSession(data.session ?? null))
      .catch(() => {})
      .finally(() => setStaffSessionLoading(false))
  }, [])

  const fetchSales = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const url = dataFiltri
        ? `/api/sales?data=${dataFiltri}`
        : periudha === 'te-gjitha'
          ? '/api/sales'
          : `/api/sales?periudha=${periudha}`
      const res = await fetch(url)
      if (res.status === 401) {
        window.location.href = staffSession ? '/staff-login' : '/login'
        return
      }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSales(toArray<Sale>(data, 'sales'))
    } catch {
      setError(true)
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [periudha, dataFiltri])

  useEffect(() => {
    fetchSales()
  }, [fetchSales])

  const handleDelete = async () => {
    if (!saleToDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/sales/${saleToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Fatura u fshi me sukses')
      setSaleToDelete(null)
      fetchSales()
    } catch {
      toast.error('Fshirja dështoi')
    } finally {
      setDeleting(false)
    }
  }

  const openEditModal = async (sale: Sale) => {
    setSaleToEdit(sale)
    setEditItems(
      sale.items.map((item) => ({
        productId: item.productId,
        emriProduktit: item.emriProduktit,
        sasia: item.sasia,
        cmimiBlerjes: item.cmimiBlerjes,
        cmimiShitjes: item.cmimiShitjes,
        njesia: item.product?.njesia || 'copë',
        availableStock: (item.product?.sasia ?? 0) + item.sasia,
      }))
    )
    setAddProductSearch('')
    setShowAddProduct(false)

    if (allProducts.length === 0) {
      try {
        const res = await fetch('/api/products')
        const data = await res.json()
        setAllProducts(toArray<Product>(data, 'products'))
      } catch {
        // silent
      }
    }
  }

  const updateEditItemQty = (idx: number, value: number) => {
    setEditItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const min = isWeighted(item.njesia) ? 0.001 : 1
        const clamped = Math.max(min, Math.min(value, item.availableStock))
        return { ...item, sasia: clamped }
      })
    )
  }

  const removeEditItem = (idx: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const addProductToEdit = (product: Product) => {
    if (product.sasia <= 0) {
      toast.error(`${product.emri} — Stoku i mbaruar`)
      return
    }
    setEditItems((prev) => {
      if (prev.some((i) => i.productId === product.id)) {
        toast.error(`${product.emri} është tashmë në listë`)
        return prev
      }
      return [
        ...prev,
        {
          productId: product.id,
          emriProduktit: product.emri,
          sasia: isWeighted(product.njesia) ? 0.1 : 1,
          cmimiBlerjes: product.cmimiBlerjes,
          cmimiShitjes: product.cmimiShitjes,
          njesia: product.njesia,
          availableStock: product.sasia,
        },
      ]
    })
    setAddProductSearch('')
    setShowAddProduct(false)
  }

  const handleEditSave = async () => {
    if (!saleToEdit) return
    if (editItems.length === 0) {
      toast.error('Nuk ka produkte në shitje')
      return
    }
    for (const item of editItems) {
      if (item.sasia <= 0) {
        toast.error(`Sasia duhet të jetë pozitive për: ${item.emriProduktit}`)
        return
      }
    }

    setEditSaving(true)
    try {
      const res = await fetch(`/api/sales/${saleToEdit.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: editItems.map((item) => ({
            productId: item.productId,
            emriProduktit: item.emriProduktit,
            sasia: item.sasia,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Gabim gjatë ruajtjes')
        return
      }

      toast.success('Fatura u përditësua me sukses')
      setSaleToEdit(null)
      fetchSales()
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setEditSaving(false)
    }
  }

  const editTotali = editItems.reduce((sum, item) => sum + item.cmimiShitjes * item.sasia, 0)
  const editFitimi = editItems.reduce((sum, item) => sum + (item.cmimiShitjes - item.cmimiBlerjes) * item.sasia, 0)

  const filteredAddProducts = allProducts
    .filter(
      (p) =>
        p.emri.toLowerCase().includes(addProductSearch.toLowerCase()) ||
        p.kategoria.toLowerCase().includes(addProductSearch.toLowerCase())
    )
    .filter((p) => !editItems.some((i) => i.productId === p.id))
    .slice(0, 8)

  const totaliPeriudhes = sales.reduce((sum, s) => sum + s.totali, 0)
  const fiitimiPeriudhes = sales.reduce((sum, s) => sum + s.fitimi, 0)

  const hasStaffAccess = staffSession?.staffRole === 'Cashier'
  if (!staffSessionLoading && !role && !hasStaffAccess) return <AccessDenied />
  if (role && !['Administrator', 'Manager', 'Cashier'].includes(role)) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const isAdmin = role === 'Administrator' || role === 'Manager'

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Historiku i Shitjeve"
        subtitle={`${sales.length} shitje gjatë periudhës`}
      />

      {/* Period Filter + Date + Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          {PERIUDHAT.map((p) => (
            <button
              key={p.value}
              onClick={() => { setPeriudha(p.value); setDataFiltri('') }}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                periudha === p.value && !dataFiltri
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
          <input
            type="date"
            value={dataFiltri}
            onChange={(e) => setDataFiltri(e.target.value)}
            className="input !w-auto text-sm"
          />
          {dataFiltri && (
            <button
              onClick={() => setDataFiltri('')}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-all"
            >
              Pastro filtrin
            </button>
          )}
        </div>
        <ExportButtons periudha={periudha} />
      </div>

      {/* Summary Cards */}
      {sales.length > 0 && (
        <div className={`grid ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'} gap-2 sm:gap-4 mb-6`}>
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Shitjet Totale</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{formatCurrency(totaliPeriudhes)}</p>
          </div>
          {isAdmin && (
            <div className="card p-3 sm:p-4">
              <p className="text-xs font-medium text-slate-500 mb-1">Fitimi Total</p>
              <p className="text-base sm:text-xl font-bold text-green-700">{formatCurrency(fiitimiPeriudhes)}</p>
            </div>
          )}
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Numri i Shitjeve</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{sales.length}</p>
          </div>
        </div>
      )}

      {/* Sales Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={isAdmin ? 9 : 7} />
        ) : error ? (
          <ErrorState message="Gabim gjatë ngarkimit të shitjeve" onRetry={fetchSales} />
        ) : sales.length === 0 ? (
          <div className="p-12 text-center">
            <RiReceiptLine className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400">Nuk ka shitje për këtë periudhë</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Fatura #</th>
                  <th className="table-th">Data & Ora</th>
                  <th className="table-th">Produktet</th>
                  <th className="table-th text-center">Njësi</th>
                  <th className="table-th text-center">Pagesa</th>
                  <th className="table-th text-right">Totali</th>
                  {isAdmin && <th className="table-th text-right">Fitimi</th>}
                  <th className="table-th text-center">Detaje</th>
                  <th className="table-th text-center">Edito</th>
                  {isAdmin && <th className="table-th text-center">Fshi</th>}
                </tr>
              </thead>
              <tbody>
                {sales.map((sale, idx) => (
                  <motion.tr
                    key={sale.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className="table-row"
                  >
                    <td className="table-td font-mono font-semibold text-blue-600">
                      #{sale.id}
                    </td>
                    <td className="table-td text-slate-500">
                      {formatDateTime(sale.createdAt)}
                    </td>
                    <td className="table-td">
                      <span className="text-slate-700">
                        {sale.items.slice(0, 2).map((i) => i.emriProduktit).join(', ')}
                        {sale.items.length > 2 ? ` +${sale.items.length - 2} të tjerë` : ''}
                      </span>
                    </td>
                    <td className="table-td text-center">
                      <span className="badge-gray">
                        {sale.items.reduce((s, i) => s + i.sasia, 0)}
                      </span>
                    </td>
                    <td className="table-td text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        sale.paymentMethod === 'bank'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {sale.paymentMethod === 'bank' ? 'Bankë' : 'Cash'}
                      </span>
                    </td>
                    <td className="table-td text-right font-semibold text-slate-900">
                      {formatCurrency(sale.totali)}
                    </td>
                    {isAdmin && (
                      <td className="table-td text-right font-semibold text-green-700">
                        {formatCurrency(sale.fitimi)}
                      </td>
                    )}
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSelectedSale(sale)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Shiko detajet"
                      >
                        <RiArrowDownLine className="text-lg" />
                      </button>
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => openEditModal(sale)}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                        title="Edito faturën"
                      >
                        <RiEditLine className="text-lg" />
                      </button>
                    </td>
                    {isAdmin && (
                      <td className="table-td text-center">
                        <button
                          onClick={() => setSaleToDelete(sale)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Fshi faturën"
                        >
                          <RiDeleteBin6Line className="text-lg" />
                        </button>
                      </td>
                    )}
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!saleToDelete}
        onClose={() => !deleting && setSaleToDelete(null)}
        title="Fshi Faturën"
        size="sm"
      >
        {saleToDelete && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <RiDeleteBin6Line className="text-red-600 text-xl" />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                A je i sigurt që dëshiron ta fshish këtë faturë?
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 mb-5 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Fatura</span>
                <span className="font-mono font-semibold text-blue-600">#{saleToDelete.id}</span>
              </div>
              <div className="flex justify-between text-slate-600 mt-1">
                <span>Totali</span>
                <span className="font-semibold">{formatCurrency(saleToDelete.totali)}</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              Stoku i produkteve do të rikthehet automatikisht.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setSaleToDelete(null)}
                disabled={deleting}
                className="btn-secondary flex-1"
              >
                Anulo
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {deleting ? 'Duke fshirë...' : 'Fshi Faturën'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Sale Detail Modal */}
      <Modal
        isOpen={!!selectedSale}
        onClose={() => setSelectedSale(null)}
        title={`Detajet e Shitjes #${selectedSale?.id}`}
        size="md"
      >
        {selectedSale && (
          <div>
            <p className="text-xs text-slate-400 mb-4">{formatDateTime(selectedSale.createdAt)}</p>

            <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">Produkti</th>
                    <th className="table-th text-center">Sasia</th>
                    <th className="table-th text-right">Çmimi</th>
                    <th className="table-th text-right">Fitimi</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSale.items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="table-td font-medium">{item.emriProduktit}</td>
                      <td className="table-td text-center">{item.sasia}</td>
                      <td className="table-td text-right">{formatCurrency(item.cmimiShitjes * item.sasia)}</td>
                      <td className="table-td text-right text-green-600">{formatCurrency(item.fitimi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Totali i Shitjes</span>
                <span className="font-semibold text-slate-900">{formatCurrency(selectedSale.totali)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fitimi Neto</span>
                <span className="font-semibold text-green-700">{formatCurrency(selectedSale.fitimi)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Marzhi</span>
                <span className="font-semibold text-blue-600">
                  {((selectedSale.fitimi / selectedSale.totali) * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Mënyra e Pagesës</span>
                <span className={`font-semibold ${selectedSale.paymentMethod === 'bank' ? 'text-violet-700' : 'text-emerald-700'}`}>
                  {selectedSale.paymentMethod === 'bank' ? 'Bankë / Kartë' : 'Cash'}
                </span>
              </div>
            </div>

            <button
              onClick={() => setSelectedSale(null)}
              className="btn-secondary w-full mt-4"
            >
              Mbyll
            </button>
          </div>
        )}
      </Modal>

      {/* Edit Sale Modal */}
      <Modal
        isOpen={!!saleToEdit}
        onClose={() => !editSaving && setSaleToEdit(null)}
        title={`Edito Faturën #${saleToEdit?.id}`}
        size="xl"
      >
        {saleToEdit && (
          <div>
            {/* Items list */}
            <div className="mb-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Produktet në Faturë
              </p>

              {editItems.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl">
                  Nuk ka produkte. Shto produkte më poshtë.
                </div>
              ) : (
                <div className="space-y-2">
                  {editItems.map((item, idx) => (
                    <div
                      key={`${item.productId}-${idx}`}
                      className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {item.emriProduktit}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {formatCurrency(item.cmimiShitjes)} / {item.njesia} &middot; Stok disponibël: {item.availableStock}
                        </p>
                      </div>

                      {/* Quantity controls */}
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() =>
                            updateEditItemQty(
                              idx,
                              item.sasia - (isWeighted(item.njesia) ? 0.1 : 1)
                            )
                          }
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                        >
                          <RiSubtractLine className="text-xs" />
                        </button>

                        <input
                          type="number"
                          value={item.sasia}
                          min={isWeighted(item.njesia) ? 0.001 : 1}
                          max={item.availableStock}
                          step={isWeighted(item.njesia) ? 0.1 : 1}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) updateEditItemQty(idx, val)
                          }}
                          className="w-16 text-center text-sm font-medium border border-slate-200 rounded-lg py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />

                        <button
                          onClick={() =>
                            updateEditItemQty(
                              idx,
                              item.sasia + (isWeighted(item.njesia) ? 0.1 : 1)
                            )
                          }
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                        >
                          <RiAddLine className="text-xs" />
                        </button>

                        <span className="text-xs text-slate-400 w-8 text-left">{item.njesia}</span>
                      </div>

                      {/* Item total */}
                      <div className="w-20 text-right">
                        <p className="text-sm font-semibold text-slate-900">
                          {formatCurrency(item.cmimiShitjes * item.sasia)}
                        </p>
                      </div>

                      {/* Remove button */}
                      <button
                        onClick={() => removeEditItem(idx)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="Largo produktin"
                      >
                        <RiCloseLine className="text-base" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add product section */}
            <div className="border-t border-slate-100 pt-4 mb-5">
              {!showAddProduct ? (
                <button
                  onClick={() => setShowAddProduct(true)}
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  <RiAddLine className="text-base" />
                  Shto Produkt
                </button>
              ) : (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Kërko produkt për të shtuar..."
                      value={addProductSearch}
                      onChange={(e) => setAddProductSearch(e.target.value)}
                      autoFocus
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => {
                        setShowAddProduct(false)
                        setAddProductSearch('')
                      }}
                      className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <RiCloseLine className="text-lg" />
                    </button>
                  </div>

                  {addProductSearch && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                      {filteredAddProducts.length === 0 ? (
                        <p className="text-sm text-slate-400 p-3 text-center">Nuk u gjet produkt</p>
                      ) : (
                        filteredAddProducts.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => addProductToEdit(p)}
                            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0 transition-colors"
                          >
                            <div>
                              <p className="text-sm font-medium text-slate-900">{p.emri}</p>
                              <p className="text-xs text-slate-400">
                                {p.kategoria} &middot; Stok: {p.sasia} {p.njesia}
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-blue-600 ml-4">
                              {formatCurrency(p.cmimiShitjes)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Real-time summary */}
            <div className="bg-slate-50 rounded-xl p-4 mb-5 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Totali i Ri</span>
                <span className="font-semibold text-slate-900">{formatCurrency(editTotali)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fitimi i Ri</span>
                <span className="font-semibold text-green-700">{formatCurrency(editFitimi)}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setSaleToEdit(null)}
                disabled={editSaving}
                className="btn-secondary flex-1"
              >
                Anulo
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving || editItems.length === 0}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {editSaving ? 'Duke ruajtur...' : 'Ruaj Ndryshimet'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
