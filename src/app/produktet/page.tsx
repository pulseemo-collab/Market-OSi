'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import SubscriptionExpired from '@/components/SubscriptionExpired'
import { useSubscription } from '@/hooks/useSubscription'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency, isLowStock, toArray } from '@/lib/utils'
import TableSkeleton from '@/components/ui/TableSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import { useIdempotencyKey } from '@/hooks/useIdempotencyKey'
import {
  RiAddLine,
  RiSearchLine,
  RiEditLine,
  RiDeleteBin6Line,
  RiFilterLine,
  RiCloseLine,
  RiBarcodeLine,
} from 'react-icons/ri'

interface Supplier {
  id: number
  emri: string
}

interface ProductBarcode {
  id: number
  barcode: string
}

interface Product {
  id: number
  emri: string
  barcodes: ProductBarcode[]
  kategoria: string
  sasia: number
  stokuMinimal: number
  cmimiBlerjes: number
  cmimiShitjes: number
  njesia: string
  isArchived: boolean
  archivedAt: string | null
  furnitorId: number | null
  furnitor: Supplier | null
  createdAt: string
}

const KATEGORITE = [
  'Të Ndryshme',
  'Të Ëmbla',
  'Të Kripura',
  'Ushqimore',
  'Higjena',
  'Pastrimi',
  'Lëngje',
  'Të Ngrira',
  'Fresh',
  'Fruta/Perime'
]

const NJESITE = ['copë', 'kg', 'gram', 'litër', 'shishe', 'paketë', 'kuti', 'qese', 'tufë']

const emptyForm = {
  emri: '',
  barcodes: [] as string[],
  kategoria: KATEGORITE[0],
  sasia: '0',
  stokuMinimal: '5',
  cmimiBlerjes: '',
  cmimiShitjes: '',
  njesia: 'copë',
  furnitorId: '',
}

export default function ProduktetPage() {
  const { role } = useRole()
  const productIdempotency = useIdempotencyKey()
  const subscription = useSubscription()
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [kerkimi, setKerkimi] = useState('')
  const [kategoriaFilter, setKategoriaFilter] = useState('')
  const [arkivuarFilter, setArkivuarFilter] = useState<'active' | 'archived' | 'all'>('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModal, setDeleteModal] = useState<Product | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [form, setForm] = useState<typeof emptyForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeError, setBarcodeError] = useState('')
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const barcodeInputRef = useRef<HTMLInputElement>(null)

  const safeProducts = Array.isArray(products) ? products : []
  const safeSuppliers = Array.isArray(suppliers) ? suppliers : []

  const fetchProducts = useCallback(async () => {
    if (!role || !['Administrator', 'Manager'].includes(role)) {
      setLoading(false)
      return
    }
    setError(false)
    const params = new URLSearchParams()
    if (kerkimi) params.set('kerkimi', kerkimi)
    if (kategoriaFilter) params.set('kategoria', kategoriaFilter)
    params.set('arkivuar', arkivuarFilter)
    try {
      const res = await fetch(`/api/products?${params}`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setProducts(toArray<Product>(data, 'products'))
    } catch {
      setError(true)
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [kerkimi, kategoriaFilter, arkivuarFilter, role])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then((data) => setSuppliers(toArray<Supplier>(data, 'suppliers')))
      .catch(() => setSuppliers([]))
  }, [])

  function openAdd() {
    setEditProduct(null)
    setForm({ ...emptyForm, kategoria: kategoriaFilter || KATEGORITE[0] })
    setBarcodeInput('')
    setBarcodeError('')
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setEditProduct(product)
    setForm({
      emri: product.emri,
      barcodes: product.barcodes.map((b) => b.barcode),
      kategoria: product.kategoria,
      sasia: String(product.sasia),
      stokuMinimal: String(product.stokuMinimal),
      cmimiBlerjes: String(product.cmimiBlerjes),
      cmimiShitjes: String(product.cmimiShitjes),
      njesia: product.njesia,
      furnitorId: product.furnitorId ? String(product.furnitorId) : '',
    })
    setBarcodeInput('')
    setBarcodeError('')
    setFormErrors({})
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setBarcodeInput('')
    setBarcodeError('')
    setFormErrors({})
  }

  function handleBarcodeAdd() {
    const code = barcodeInput.trim()
    if (!code) return

    if (form.barcodes.includes(code)) {
      setBarcodeError('Ky barkod është shtuar tashmë')
      return
    }

    if (form.barcodes.length >= 10) {
      setBarcodeError('Maksimumi 10 barkode për produkt')
      return
    }

    const isDuplicate = safeProducts.some(
      (p) =>
        (!editProduct || p.id !== editProduct.id) &&
        p.barcodes.some((b) => b.barcode === code)
    )
    if (isDuplicate) {
      setBarcodeError('Ky barkod ekziston te një produkt tjetër')
      return
    }

    setForm((f) => ({ ...f, barcodes: [...f.barcodes, code] }))
    setBarcodeInput('')
    setBarcodeError('')
    barcodeInputRef.current?.focus()
  }

  function handleBarcodeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBarcodeAdd()
    }
  }

  function removeBarcode(idx: number) {
    setForm((f) => ({ ...f, barcodes: f.barcodes.filter((_, i) => i !== idx) }))
  }

  async function handleSave() {
    const errors: Record<string, string> = {}
    if (!form.emri.trim()) errors.emri = 'Emri është i detyrueshëm'
    if (!form.cmimiBlerjes) errors.cmimiBlerjes = 'Çmimi i blerjes është i detyrueshëm'
    else if (isNaN(Number(form.cmimiBlerjes)) || Number(form.cmimiBlerjes) < 0) errors.cmimiBlerjes = 'Çmimi duhet të jetë numër pozitiv'
    if (!form.cmimiShitjes) errors.cmimiShitjes = 'Çmimi i shitjes është i detyrueshëm'
    else if (isNaN(Number(form.cmimiShitjes)) || Number(form.cmimiShitjes) < 0) errors.cmimiShitjes = 'Çmimi duhet të jetë numër pozitiv'
    if (form.sasia !== '' && isNaN(Number(form.sasia))) errors.sasia = 'Sasia duhet të jetë numër'
    if (form.stokuMinimal !== '' && isNaN(Number(form.stokuMinimal))) errors.stokuMinimal = 'Stoku minimal duhet të jetë numër'
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return }
    setFormErrors({})

    const validBarcodes = form.barcodes

    setSaving(true)
    try {
      const url = editProduct ? `/api/products/${editProduct.id}` : '/api/products'
      const method = editProduct ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...productIdempotency.headers() },
        body: JSON.stringify({
          emri: form.emri,
          barcodes: validBarcodes,
          kategoria: form.kategoria,
          sasia: Number(form.sasia),
          stokuMinimal: Number(form.stokuMinimal),
          cmimiBlerjes: Number(form.cmimiBlerjes),
          cmimiShitjes: Number(form.cmimiShitjes),
          njesia: form.njesia,
          furnitorId: form.furnitorId ? Number(form.furnitorId) : null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Gabim gjatë ruajtjes')
        return
      }
      productIdempotency.reset()
      toast.success(editProduct ? 'Produkti u përditësua' : 'Produkti u shtua')
      closeModal()
      fetchProducts()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(product: Product) {
    const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' })
    if (res.ok) {
      const data = await res.json()
      if (data.arkivuar) {
        toast.success('Produkti u arkivua sepse ka histori shitjesh.')
      } else {
        toast.success('Produkti u fshi me sukses.')
      }
      setDeleteModal(null)
      fetchProducts()
    } else {
      toast.error('Gabim gjatë fshirjes')
    }
  }

  const activeProducts = safeProducts.filter((p) => !p.isArchived)
  const lowStockCount = activeProducts.filter((p) => isLowStock(p.sasia, p.stokuMinimal)).length

  if (!role || !['Administrator', 'Manager'].includes(role)) return <AccessDenied />
  if (subscription === 'blocked') return <SubscriptionExpired />

  const isAdmin = role === 'Administrator' || role === 'Manager'

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Produktet"
        subtitle={loading ? 'Duke ngarkuar...' : `${safeProducts.length} produkte${lowStockCount > 0 ? ` · ${lowStockCount} me stok të ulët` : ''}`}
        action={
          isAdmin ? (
            <button onClick={openAdd} className="btn-primary flex items-center gap-2">
              <RiAddLine className="text-lg" />
              Shto Produkt
            </button>
          ) : undefined
        }
      />

      {/* Filters */}
      <div className="card p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Kërko produkt, barkod..."
              value={kerkimi}
              onChange={(e) => setKerkimi(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="relative sm:w-52">
            <RiFilterLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={kategoriaFilter}
              onChange={(e) => setKategoriaFilter(e.target.value)}
              className="input pl-10 appearance-none"
            >
              <option value="">Të gjitha kategorite</option>
              {KATEGORITE.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="relative sm:w-44">
            <select
              value={arkivuarFilter}
              onChange={(e) => setArkivuarFilter(e.target.value as 'active' | 'archived' | 'all')}
              className="input appearance-none"
            >
              <option value="active">Aktive</option>
              <option value="archived">Të Arkivuara</option>
              <option value="all">Të Gjitha</option>
            </select>
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : error ? (
          <ErrorState message="Gabim gjatë ngarkimit të produkteve" onRetry={fetchProducts} />
        ) : safeProducts.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-400 mb-3">Nuk u gjet asnjë produkt</p>
            <button onClick={openAdd} className="btn-primary">Shto Produkt</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Produkti</th>
                  <th className="table-th">Barkodi</th>
                  <th className="table-th">Kategoria</th>
                  <th className="table-th text-center">Stoku</th>
                  <th className="table-th text-right">Çm. Blerjes</th>
                  <th className="table-th text-right">Çm. Shitjes</th>
                  <th className="table-th">Furnitori</th>
                  <th className="table-th text-center">Veprimet</th>
                </tr>
              </thead>
              <tbody>
                {safeProducts.map((product, idx) => {
                  const lowStock = isLowStock(product.sasia, product.stokuMinimal)
                  return (
                    <motion.tr
                      key={product.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.02 }}
                      className="table-row"
                    >
                      <td className="table-td">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-slate-900">{product.emri}</span>
                          {product.isArchived && (
                            <span className="text-xs text-amber-600 font-medium">Arkivuar</span>
                          )}
                        </div>
                      </td>
                      <td className="table-td">
                        {product.barcodes.length === 0 ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div>
                            <span className="font-mono text-xs text-slate-500">
                              {product.barcodes[0].barcode}
                            </span>
                            {product.barcodes.length > 1 && (
                              <span className="ml-1.5 text-xs text-blue-500">
                                +{product.barcodes.length - 1}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="table-td">
                        <span className="badge-gray">{product.kategoria}</span>
                      </td>
                      <td className="table-td text-center">
                        <span className={lowStock ? 'badge-red' : 'badge-green'}>
                          {product.sasia} {product.njesia}
                        </span>
                        {lowStock && (
                          <p className="text-xs text-red-400 mt-0.5">Min: {product.stokuMinimal}</p>
                        )}
                      </td>
                      <td className="table-td text-right text-slate-500">
                        {formatCurrency(product.cmimiBlerjes)}
                      </td>
                      <td className="table-td text-right font-semibold text-slate-900">
                        {formatCurrency(product.cmimiShitjes)}
                      </td>
                      <td className="table-td text-slate-500">
                        {product.furnitor?.emri || '—'}
                      </td>
                      <td className="table-td">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => openEdit(product)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Ndrysho"
                          >
                            <RiEditLine className="text-lg" />
                          </button>
                          {isAdmin && (
                            <button
                              onClick={() => setDeleteModal(product)}
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Fshi"
                            >
                              <RiDeleteBin6Line className="text-lg" />
                            </button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editProduct ? 'Ndrysho Produkt' : 'Shto Produkt të Ri'}
        size="lg"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Emri i Produktit *</label>
            <input
              type="text"
              value={form.emri}
              onChange={(e) => { setForm({ ...form, emri: e.target.value }); if (formErrors.emri) setFormErrors((p) => ({ ...p, emri: '' })) }}
              className={`input ${formErrors.emri ? 'border-red-400 focus:border-red-400' : ''}`}
              placeholder="p.sh. Bukë e Bardhë"
            />
            {formErrors.emri && <p className="text-xs text-red-500 mt-1">{formErrors.emri}</p>}
          </div>

          {/* Barcode scanner section */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="label mb-0">Barkodi</label>
              <span className="text-xs text-slate-400">{form.barcodes.length}/10</span>
            </div>

            {/* Scan input */}
            <div className="relative mb-2">
              <RiBarcodeLine className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
              <input
                ref={barcodeInputRef}
                type="text"
                value={barcodeInput}
                onChange={(e) => {
                  setBarcodeInput(e.target.value)
                  if (barcodeError) setBarcodeError('')
                }}
                onKeyDown={handleBarcodeInputKeyDown}
                placeholder="Skano ose shkruaj barkodin..."
                className={`input pl-9 font-mono ${barcodeError ? 'border-red-400 focus:border-red-400' : ''}`}
                autoComplete="off"
                spellCheck={false}
                disabled={form.barcodes.length >= 10}
              />
            </div>

            {barcodeError && (
              <p className="text-xs text-red-500 mb-2 pl-0.5">{barcodeError}</p>
            )}

            {/* Barcode chips */}
            {form.barcodes.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.barcodes.map((bc, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-slate-100 text-slate-700 text-xs font-mono px-2.5 py-1 rounded-lg"
                  >
                    {bc}
                    <button
                      type="button"
                      onClick={() => removeBarcode(idx)}
                      className="text-slate-400 hover:text-red-500 transition-colors ml-0.5"
                      title="Hiq barkod"
                    >
                      <RiCloseLine />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Manual add button */}
            {form.barcodes.length < 10 && (
              <button
                type="button"
                onClick={handleBarcodeAdd}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mt-0.5"
              >
                <RiAddLine />
                Shto barkod të ri
              </button>
            )}
          </div>

          <div>
            <label className="label">Kategoria *</label>
            <select
              value={form.kategoria}
              onChange={(e) => setForm({ ...form, kategoria: e.target.value })}
              className="input"
            >
              {KATEGORITE.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Njësia</label>
            <select
              value={form.njesia}
              onChange={(e) => setForm({ ...form, njesia: e.target.value })}
              className="input"
            >
              {NJESITE.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">
              Çmimi i Blerjes (L) *{!isAdmin && <span className="ml-1 text-xs text-slate-400">(vetëm admin)</span>}
            </label>
            <input
              type="number"
              value={form.cmimiBlerjes}
              onChange={(e) => { isAdmin && setForm({ ...form, cmimiBlerjes: e.target.value }); if (formErrors.cmimiBlerjes) setFormErrors((p) => ({ ...p, cmimiBlerjes: '' })) }}
              className={`input ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''} ${formErrors.cmimiBlerjes ? 'border-red-400 focus:border-red-400' : ''}`}
              placeholder="0"
              min="0"
              readOnly={!isAdmin}
            />
            {formErrors.cmimiBlerjes && <p className="text-xs text-red-500 mt-1">{formErrors.cmimiBlerjes}</p>}
          </div>
          <div>
            <label className="label">
              Çmimi i Shitjes (L) *{!isAdmin && <span className="ml-1 text-xs text-slate-400">(vetëm admin)</span>}
            </label>
            <input
              type="number"
              value={form.cmimiShitjes}
              onChange={(e) => { isAdmin && setForm({ ...form, cmimiShitjes: e.target.value }); if (formErrors.cmimiShitjes) setFormErrors((p) => ({ ...p, cmimiShitjes: '' })) }}
              className={`input ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''} ${formErrors.cmimiShitjes ? 'border-red-400 focus:border-red-400' : ''}`}
              placeholder="0"
              min="0"
              readOnly={!isAdmin}
            />
            {formErrors.cmimiShitjes && <p className="text-xs text-red-500 mt-1">{formErrors.cmimiShitjes}</p>}
          </div>
          <div>
            <label className="label">Sasia në Stok</label>
            <input
              type="number"
              value={form.sasia}
              onChange={(e) => { setForm({ ...form, sasia: e.target.value }); if (formErrors.sasia) setFormErrors((p) => ({ ...p, sasia: '' })) }}
              className={`input ${formErrors.sasia ? 'border-red-400 focus:border-red-400' : ''}`}
              min="0"
              step={form.njesia === 'kg' || form.njesia === 'gram' ? '0.001' : '1'}
            />
            {formErrors.sasia && <p className="text-xs text-red-500 mt-1">{formErrors.sasia}</p>}
          </div>
          <div>
            <label className="label">Stoku Minimal</label>
            <input
              type="number"
              value={form.stokuMinimal}
              onChange={(e) => { setForm({ ...form, stokuMinimal: e.target.value }); if (formErrors.stokuMinimal) setFormErrors((p) => ({ ...p, stokuMinimal: '' })) }}
              className={`input ${formErrors.stokuMinimal ? 'border-red-400 focus:border-red-400' : ''}`}
              min="0"
              step={form.njesia === 'kg' || form.njesia === 'gram' ? '0.001' : '1'}
            />
            {formErrors.stokuMinimal && <p className="text-xs text-red-500 mt-1">{formErrors.stokuMinimal}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="label">Furnitori</label>
            <select
              value={form.furnitorId}
              onChange={(e) => setForm({ ...form, furnitorId: e.target.value })}
              className="input"
            >
              <option value="">Pa furnitor</option>
              {safeSuppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.emri}</option>
              ))}
            </select>
          </div>
          {/* Profit preview */}
          {form.cmimiBlerjes && form.cmimiShitjes && (
            <div className="sm:col-span-2 p-3 bg-green-50 rounded-lg">
              <p className="text-sm text-green-700">
                Fitimi për njësi:{' '}
                <strong>
                  {formatCurrency(Number(form.cmimiShitjes) - Number(form.cmimiBlerjes))}
                </strong>{' '}
                ({(((Number(form.cmimiShitjes) - Number(form.cmimiBlerjes)) / Number(form.cmimiBlerjes)) * 100).toFixed(1)}% marzh)
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? 'Duke ruajtur...' : editProduct ? 'Ruaj Ndryshimet' : 'Shto Produkt'}
          </button>
          <button onClick={closeModal} className="btn-secondary">
            Anulo
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Konfirmo Fshirjen"
        size="sm"
      >
        <p className="text-slate-600 mb-5">
          Jeni i sigurt që dëshironi të fshini{' '}
          <strong className="text-slate-900">{deleteModal?.emri}</strong>?
          Ky veprim nuk mund të kthehet mbrapsht.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => deleteModal && handleDelete(deleteModal)}
            className="btn-danger flex-1"
          >
            Po, Fshi
          </button>
          <button onClick={() => setDeleteModal(null)} className="btn-secondary">
            Anulo
          </button>
        </div>
      </Modal>
    </div>
  )
}
