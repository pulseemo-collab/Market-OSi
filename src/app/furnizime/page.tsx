'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency, formatDate, toArray } from '@/lib/utils'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiBox3Line,
  RiAddLine,
  RiDeleteBin6Line,
  RiArrowDownLine,
  RiCloseLine,
  RiSubtractLine,
} from 'react-icons/ri'

interface Supplier {
  id: number
  emri: string
}

interface Product {
  id: number
  emri: string
  kategoria: string
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  njesia: string
  barcodes: { id: number; barcode: string }[]
}

interface SupplyItemForm {
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  updatePrice: boolean
}

interface SupplyItemData {
  id: number
  productId: number
  emriProduktit: string
  sasia: number
  njesia: string
  cmimiBlerjes: number
  totali: number
  product: { id: number; emri: string; njesia: string } | null
}

interface Supply {
  id: number
  furnitorId: number | null
  furnitor: { id: number; emri: string } | null
  data: string
  shenime: string | null
  totali: number
  createdAt: string
  items: SupplyItemData[]
}

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

function getTodayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PERIUDHAT = [
  { value: 'sot',       label: 'Sot' },
  { value: 'dje',       label: 'Dje' },
  { value: 'jave',      label: 'Këtë javë' },
  { value: 'muaj',      label: 'Këtë muaj' },
  { value: 'te-gjitha', label: 'Të gjitha' },
]

export default function FurnizimePage() {
  const { role } = useRole()
  const subscription = useSubscription()
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [periudha, setPeriudha] = useState('te-gjitha')
  const [dataFiltri, setDataFiltri] = useState('')

  // Create modal
  const [showCreate, setShowCreate] = useState(false)
  const [formFurnitorId, setFormFurnitorId] = useState('')
  const [formDate, setFormDate] = useState(getTodayString())
  const [formShenime, setFormShenime] = useState('')
  const [formItems, setFormItems] = useState<SupplyItemForm[]>([])
  const [saving, setSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [showProductSearch, setShowProductSearch] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Detail / delete modals
  const [selectedSupply, setSelectedSupply] = useState<Supply | null>(null)
  const [supplyToDelete, setSupplyToDelete] = useState<Supply | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchSupplies = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/supplies')
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSupplies(toArray<Supply>(data, 'supplies'))
    } catch {
      setError(true)
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchMeta = useCallback(async () => {
    try {
      const [sRes, pRes] = await Promise.all([
        fetch('/api/suppliers'),
        fetch('/api/products'),
      ])
      const [sData, pData] = await Promise.all([sRes.json(), pRes.json()])
      setSuppliers(toArray<Supplier>(sData, 'suppliers'))
      setProducts(toArray<Product>(pData, 'products'))
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    fetchSupplies()
    fetchMeta()
  }, [fetchSupplies, fetchMeta])

  const openCreate = () => {
    setFormFurnitorId('')
    setFormDate(getTodayString())
    setFormShenime('')
    setFormItems([])
    setProductSearch('')
    setShowProductSearch(false)
    setShowCreate(true)
  }

  const addProductToForm = (product: Product, keepOpen = false) => {
    setFormItems((prev) => {
      const existingIdx = prev.findIndex((i) => i.productId === product.id)
      if (existingIdx !== -1) {
        return prev.map((item, i) => {
          if (i !== existingIdx) return item
          const step = isWeighted(item.njesia) ? 0.1 : 1
          const min = isWeighted(item.njesia) ? 0.001 : 1
          return { ...item, sasia: Math.max(min, item.sasia + step) }
        })
      }
      return [
        ...prev,
        {
          productId: product.id,
          emriProduktit: product.emri,
          sasia: isWeighted(product.njesia) ? 1.0 : 1,
          njesia: product.njesia,
          cmimiBlerjes: product.cmimiBlerjes,
          updatePrice: false,
        },
      ]
    })
    setProductSearch('')
    if (!keepOpen) {
      setShowProductSearch(false)
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const query = productSearch.trim()
    if (!query) return
    const matched = products.find((p) =>
      p.barcodes.some((b) => b.barcode === query)
    )
    if (matched) {
      addProductToForm(matched, true)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else {
      toast.error('Produkti nuk u gjet')
      setProductSearch('')
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  const updateFormItemQty = (idx: number, value: number) => {
    setFormItems((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item
        const min = isWeighted(item.njesia) ? 0.001 : 1
        return { ...item, sasia: Math.max(min, value) }
      })
    )
  }

  const updateFormItemPrice = (idx: number, value: number) => {
    setFormItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, cmimiBlerjes: Math.max(0, value) } : item
      )
    )
  }

  const toggleUpdatePrice = (idx: number) => {
    setFormItems((prev) =>
      prev.map((item, i) =>
        i === idx ? { ...item, updatePrice: !item.updatePrice } : item
      )
    )
  }

  const removeFormItem = (idx: number) => {
    setFormItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const formTotal = formItems.reduce((sum, item) => sum + item.sasia * item.cmimiBlerjes, 0)

  const handleCreate = async () => {
    if (formItems.length === 0) {
      toast.error('Shto të paktën një produkt')
      return
    }
    for (const item of formItems) {
      if (item.sasia <= 0) {
        toast.error(`Sasia duhet të jetë pozitive për: ${item.emriProduktit}`)
        return
      }
      if (item.cmimiBlerjes < 0) {
        toast.error(`Çmimi i blerjes i pavlefshëm për: ${item.emriProduktit}`)
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/supplies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          furnitorId: formFurnitorId ? parseInt(formFurnitorId) : null,
          data: formDate || getTodayString(),
          shenime: formShenime || null,
          items: formItems.map((item) => ({
            productId: item.productId,
            emriProduktit: item.emriProduktit,
            sasia: item.sasia,
            njesia: item.njesia,
            cmimiBlerjes: item.cmimiBlerjes,
            updatePrice: item.updatePrice,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Gabim gjatë ruajtjes')
        return
      }

      toast.success('Furnizimi u ruajt me sukses')
      setShowCreate(false)
      fetchSupplies()
    } catch {
      toast.error('Gabim gjatë ruajtjes')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!supplyToDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/supplies/${supplyToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Furnizimi u fshi. Stoku u përditësua.')
      setSupplyToDelete(null)
      fetchSupplies()
    } catch {
      toast.error('Fshirja dështoi')
    } finally {
      setDeleting(false)
    }
  }

  // Client-side period + date filter
  const filteredSupplies = supplies.filter((s) => {
    // Exact date filter overrides period
    if (dataFiltri) {
      const sDate = new Date(s.data)
      const fDate = new Date(dataFiltri)
      return (
        sDate.getFullYear() === fDate.getFullYear() &&
        sDate.getMonth() === fDate.getMonth() &&
        sDate.getDate() === fDate.getDate()
      )
    }
    if (periudha === 'te-gjitha') return true
    const now = new Date()
    const sDate = new Date(s.data)
    if (periudha === 'sot') {
      return (
        sDate.getFullYear() === now.getFullYear() &&
        sDate.getMonth() === now.getMonth() &&
        sDate.getDate() === now.getDate()
      )
    }
    if (periudha === 'dje') {
      const yesterday = new Date(now)
      yesterday.setDate(yesterday.getDate() - 1)
      return (
        sDate.getFullYear() === yesterday.getFullYear() &&
        sDate.getMonth() === yesterday.getMonth() &&
        sDate.getDate() === yesterday.getDate()
      )
    }
    if (periudha === 'jave') {
      const weekAgo = new Date(now)
      weekAgo.setDate(weekAgo.getDate() - 7)
      weekAgo.setHours(0, 0, 0, 0)
      return sDate >= weekAgo
    }
    if (periudha === 'muaj') {
      return sDate.getMonth() === now.getMonth() && sDate.getFullYear() === now.getFullYear()
    }
    return true
  })

  const filteredSearchProducts = products
    .filter(
      (p) =>
        p.emri.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.kategoria.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.barcodes.some((b) => b.barcode.toLowerCase().includes(productSearch.toLowerCase()))
    )
    .filter((p) => !formItems.some((i) => i.productId === p.id))
    .slice(0, 8)

  const totalCost = filteredSupplies.reduce((sum, s) => sum + s.totali, 0)
  const totalItems = filteredSupplies.reduce((sum, s) => sum + s.items.length, 0)

  if (!role || !['Administrator', 'Manager'].includes(role)) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Furnizime"
        subtitle={loading ? 'Duke ngarkuar...' : `${filteredSupplies.length} furnizime · Historia e Stokut`}
        action={
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <RiAddLine className="text-base" />
            Shto Furnizim
          </button>
        }
      />

      {/* Period Filter + Date */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
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

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`card p-3 sm:p-4 animate-pulse${i === 3 ? ' col-span-2 sm:col-span-1' : ''}`}>
              <div className="h-3 bg-slate-100 rounded w-24 mb-2" />
              <div className="h-6 bg-slate-200 rounded w-20" />
            </div>
          ))}
        </div>
      ) : filteredSupplies.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-6">
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Furnizime</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{filteredSupplies.length}</p>
          </div>
          <div className="card p-3 sm:p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Kostoja</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{formatCurrency(totalCost)}</p>
          </div>
          <div className="card p-3 sm:p-4 col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-slate-500 mb-1">Produkte Furnizuara</p>
            <p className="text-base sm:text-xl font-bold text-slate-900">{totalItems}</p>
          </div>
        </div>
      ) : null}

      {/* Supply History Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : error ? (
          <ErrorState message="Gabim gjatë ngarkimit të furnizimeve" onRetry={fetchSupplies} />
        ) : filteredSupplies.length === 0 ? (
          <div className="p-12 text-center">
            <RiBox3Line className="text-4xl text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 mb-4">Nuk ka furnizime për këtë periudhë</p>
            <button onClick={openCreate} className="btn-primary">
              Shto Furnizimin e Parë
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Furnizimi #</th>
                  <th className="table-th">Data</th>
                  <th className="table-th">Furnitori</th>
                  <th className="table-th">Produktet</th>
                  <th className="table-th text-center">Artikuj</th>
                  <th className="table-th text-right">Totali</th>
                  <th className="table-th text-center">Detaje</th>
                  <th className="table-th text-center">Fshi</th>
                </tr>
              </thead>
              <tbody>
                {filteredSupplies.map((supply, idx) => (
                  <motion.tr
                    key={supply.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className="table-row"
                  >
                    <td className="table-td font-mono font-semibold text-blue-600">
                      #{supply.id}
                    </td>
                    <td className="table-td text-slate-500">
                      {formatDate(supply.data)}
                    </td>
                    <td className="table-td">
                      {supply.furnitor?.emri ? (
                        <span className="font-medium text-slate-700">{supply.furnitor.emri}</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="table-td">
                      <span className="text-slate-700">
                        {supply.items.slice(0, 2).map((i) => i.emriProduktit).join(', ')}
                        {supply.items.length > 2 ? ` +${supply.items.length - 2} të tjerë` : ''}
                      </span>
                    </td>
                    <td className="table-td text-center">
                      <span className="badge-gray">{supply.items.length}</span>
                    </td>
                    <td className="table-td text-right font-semibold text-slate-900">
                      {formatCurrency(supply.totali)}
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSelectedSupply(supply)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Shiko detajet"
                      >
                        <RiArrowDownLine className="text-lg" />
                      </button>
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSupplyToDelete(supply)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Fshi furnizimin"
                      >
                        <RiDeleteBin6Line className="text-lg" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Create Supply Modal ── */}
      <Modal
        isOpen={showCreate}
        onClose={() => !saving && setShowCreate(false)}
        title="Shto Furnizim të Ri"
        size="xl"
      >
        <div>
          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="label">Furnitori</label>
              <select
                value={formFurnitorId}
                onChange={(e) => setFormFurnitorId(e.target.value)}
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
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="input"
              />
            </div>
          </div>

          <div className="mb-5">
            <label className="label">Shënime</label>
            <textarea
              value={formShenime}
              onChange={(e) => setFormShenime(e.target.value)}
              placeholder="Shënime opsionale..."
              rows={2}
              className="input resize-none"
            />
          </div>

          {/* Products section */}
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Produkte të Furnizuara
          </p>

          {formItems.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl mb-3">
              Nuk ka produkte. Shto produkte më poshtë.
            </div>
          ) : (
            <div className="space-y-2 mb-3">
              {formItems.map((item, idx) => (
                <div
                  key={`${item.productId}-${idx}`}
                  className="p-3 bg-slate-50 rounded-xl space-y-2"
                >
                  {/* Top row: name + remove */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900 truncate flex-1">
                      {item.emriProduktit}
                    </p>
                    <button
                      onClick={() => removeFormItem(idx)}
                      className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      <RiCloseLine className="text-base" />
                    </button>
                  </div>

                  {/* Bottom row: qty + price + total */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Quantity */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          updateFormItemQty(
                            idx,
                            item.sasia - (isWeighted(item.njesia) ? 0.1 : 1)
                          )
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
                          if (!isNaN(val)) updateFormItemQty(idx, val)
                        }}
                        className="w-16 text-center text-sm border border-slate-200 rounded py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        onClick={() =>
                          updateFormItemQty(
                            idx,
                            item.sasia + (isWeighted(item.njesia) ? 0.1 : 1)
                          )
                        }
                        className="w-8 h-8 flex items-center justify-center rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors"
                      >
                        <RiAddLine className="text-xs" />
                      </button>
                      <span className="text-xs text-slate-400 w-8">{item.njesia}</span>
                    </div>

                    {/* Price */}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={item.cmimiBlerjes}
                        min={0}
                        step={0.5}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val)) updateFormItemPrice(idx, val)
                        }}
                        className="w-20 text-right text-sm border border-slate-200 rounded py-1 px-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <span className="text-xs text-slate-400">L</span>
                    </div>

                    {/* Total + checkbox */}
                    <div className="flex items-center gap-3 ml-auto">
                      <p className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                        {formatCurrency(item.sasia * item.cmimiBlerjes)}
                      </p>
                      <label className="flex items-center gap-1 cursor-pointer select-none whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={item.updatePrice}
                          onChange={() => toggleUpdatePrice(idx)}
                          className="w-3.5 h-3.5 rounded accent-blue-600"
                        />
                        <span className="text-xs text-slate-400">Përdit. çmim</span>
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add product */}
          <div className="border-t border-slate-100 pt-4 mb-5">
            {!showProductSearch ? (
              <button
                onClick={() => setShowProductSearch(true)}
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <RiAddLine className="text-base" />
                Shto Produkt
              </button>
            ) : (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Kërko emrin ose skano barkod..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    autoFocus
                    className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => {
                      setShowProductSearch(false)
                      setProductSearch('')
                    }}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <RiCloseLine className="text-lg" />
                  </button>
                </div>
                {productSearch && (
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-52 overflow-y-auto">
                    {filteredSearchProducts.length === 0 ? (
                      <p className="text-sm text-slate-400 p-3 text-center">
                        Nuk u gjet produkt
                      </p>
                    ) : (
                      filteredSearchProducts.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addProductToForm(p)}
                          className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 text-left border-b border-slate-100 last:border-0 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-900">{p.emri}</p>
                            <p className="text-xs text-slate-400">
                              {p.kategoria} · Stok aktual: {p.sasia} {p.njesia}
                            </p>
                          </div>
                          <span className="text-xs text-slate-400 ml-4 flex-shrink-0">
                            {formatCurrency(p.cmimiBlerjes)}/njësi
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Total summary */}
          <div className="bg-slate-50 rounded-xl p-4 mb-5">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-slate-500">Totali i Furnizimit</span>
              <span className="font-bold text-slate-900 text-lg">{formatCurrency(formTotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1">
              <span>{formItems.length} produkte</span>
              {formItems.filter((i) => i.updatePrice).length > 0 && (
                <span>
                  {formItems.filter((i) => i.updatePrice).length} çmime do të përditësohen
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreate(false)}
              disabled={saving}
              className="btn-secondary flex-1"
            >
              Anulo
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || formItems.length === 0}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {saving ? 'Duke ruajtur...' : 'Ruaj Furnizimin'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Supply Detail Modal ── */}
      <Modal
        isOpen={!!selectedSupply}
        onClose={() => setSelectedSupply(null)}
        title={`Detajet e Furnizimit #${selectedSupply?.id}`}
        size="lg"
      >
        {selectedSupply && (
          <div>
            <div className="grid grid-cols-2 gap-3 mb-5 p-4 bg-slate-50 rounded-xl text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Furnitori</p>
                <p className="font-medium text-slate-900">
                  {selectedSupply.furnitor?.emri || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Data</p>
                <p className="font-medium text-slate-900">{formatDate(selectedSupply.data)}</p>
              </div>
              {selectedSupply.shenime && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-400 mb-0.5">Shënime</p>
                  <p className="text-slate-700">{selectedSupply.shenime}</p>
                </div>
              )}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden mb-4">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="table-th">Produkti</th>
                    <th className="table-th text-center">Sasia</th>
                    <th className="table-th text-center">Njësia</th>
                    <th className="table-th text-right">Çm. Blerjes</th>
                    <th className="table-th text-right">Totali</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSupply.items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-100">
                      <td className="table-td font-medium">{item.emriProduktit}</td>
                      <td className="table-td text-center">
                        {isWeighted(item.njesia)
                          ? item.sasia.toFixed(3)
                          : item.sasia}
                      </td>
                      <td className="table-td text-center text-slate-400">{item.njesia}</td>
                      <td className="table-td text-right">{formatCurrency(item.cmimiBlerjes)}</td>
                      <td className="table-td text-right font-semibold">
                        {formatCurrency(item.totali)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Totali i Furnizimit</span>
                <span className="font-bold text-slate-900 text-base">
                  {formatCurrency(selectedSupply.totali)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>{selectedSupply.items.length} produkte të furnizuara</span>
              </div>
            </div>

            <button onClick={() => setSelectedSupply(null)} className="btn-secondary w-full">
              Mbyll
            </button>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        isOpen={!!supplyToDelete}
        onClose={() => !deleting && setSupplyToDelete(null)}
        title="Fshi Furnizimin"
        size="sm"
      >
        {supplyToDelete && (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <RiDeleteBin6Line className="text-red-600 text-xl" />
              </div>
              <p className="text-slate-700 text-sm leading-relaxed">
                A je i sigurt që dëshiron ta fshish këtë furnizim?
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3 mb-4 text-sm space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Furnizimi</span>
                <span className="font-mono font-semibold text-blue-600">
                  #{supplyToDelete.id}
                </span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Totali</span>
                <span className="font-semibold">{formatCurrency(supplyToDelete.totali)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Produkte</span>
                <span>{supplyToDelete.items.length} artikuj</span>
              </div>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-5">
              Stoku i produkteve do të ulet automatikisht pas fshirjes.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setSupplyToDelete(null)}
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
                {deleting ? 'Duke fshirë...' : 'Fshi Furnizimin'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
