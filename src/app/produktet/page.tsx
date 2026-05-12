'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency, isLowStock } from '@/lib/utils'
import {
  RiAddLine,
  RiSearchLine,
  RiEditLine,
  RiDeleteBin6Line,
  RiFilterLine,
  RiCloseLine,
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
  furnitorId: number | null
  furnitor: Supplier | null
  createdAt: string
}

const KATEGORITE = [
  'Të Ëmbla',
  'Të Kripura',
  'Ushqimore',
  'Higjena',
  'Pastrimi',
  'Lëngje',
  'Të Ngrira',
  'Të Ndryshme',
]

const NJESITE = ['copë', 'kg', 'litër', 'shishe', 'paketë', 'kuti', 'qese', 'tufë']

const emptyForm = {
  emri: '',
  barcodes: [''] as string[],
  kategoria: KATEGORITE[0],
  sasia: '0',
  stokuMinimal: '5',
  cmimiBlerjes: '',
  cmimiShitjes: '',
  njesia: 'copë',
  furnitorId: '',
}

export default function ProduktetPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [kerkimi, setKerkimi] = useState('')
  const [kategoriaFilter, setKategoriaFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModal, setDeleteModal] = useState<Product | null>(null)
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [form, setForm] = useState<typeof emptyForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchProducts = useCallback(async () => {
    const params = new URLSearchParams()
    if (kerkimi) params.set('kerkimi', kerkimi)
    if (kategoriaFilter) params.set('kategoria', kategoriaFilter)
    const res = await fetch(`/api/products?${params}`)
    const data = await res.json()
    setProducts(data)
    setLoading(false)
  }, [kerkimi, kategoriaFilter])

  useEffect(() => {
    fetchProducts()
  }, [fetchProducts])

  useEffect(() => {
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then(setSuppliers)
  }, [])

  function openAdd() {
    setEditProduct(null)
    setForm({
      ...emptyForm,
      kategoria: kategoriaFilter || KATEGORITE[0],
    })
    setModalOpen(true)
  }

  function openEdit(product: Product) {
    setEditProduct(product)
    setForm({
      emri: product.emri,
      barcodes: product.barcodes.length > 0
        ? product.barcodes.map((b) => b.barcode)
        : [''],
      kategoria: product.kategoria,
      sasia: String(product.sasia),
      stokuMinimal: String(product.stokuMinimal),
      cmimiBlerjes: String(product.cmimiBlerjes),
      cmimiShitjes: String(product.cmimiShitjes),
      njesia: product.njesia,
      furnitorId: product.furnitorId ? String(product.furnitorId) : '',
    })
    setModalOpen(true)
  }

  function addBarcode() {
    setForm((f) => ({ ...f, barcodes: [...f.barcodes, ''] }))
  }

  function removeBarcode(idx: number) {
    setForm((f) => ({ ...f, barcodes: f.barcodes.filter((_, i) => i !== idx) }))
  }

  function updateBarcode(idx: number, value: string) {
    setForm((f) => ({
      ...f,
      barcodes: f.barcodes.map((b, i) => (i === idx ? value : b)),
    }))
  }

  async function handleSave() {
    if (!form.emri || !form.kategoria || !form.cmimiBlerjes || !form.cmimiShitjes) {
      toast.error('Ju lutem plotësoni të gjitha fushat e detyrueshme')
      return
    }

    const validBarcodes = form.barcodes.map((b) => b.trim()).filter(Boolean)

    if (validBarcodes.length > 10) {
      toast.error('Maksimumi 10 barkode për produkt')
      return
    }

    if (new Set(validBarcodes).size !== validBarcodes.length) {
      toast.error('Ka barkode të njëjta brenda produktit')
      return
    }

    setSaving(true)
    try {
      const url = editProduct ? `/api/products/${editProduct.id}` : '/api/products'
      const method = editProduct ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
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
      toast.success(editProduct ? 'Produkti u përditësua' : 'Produkti u shtua')
      setModalOpen(false)
      fetchProducts()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(product: Product) {
    const res = await fetch(`/api/products/${product.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('Produkti u fshi')
      setDeleteModal(null)
      fetchProducts()
    } else {
      toast.error('Gabim gjatë fshirjes')
    }
  }

  const lowStockCount = products.filter((p) => isLowStock(p.sasia, p.stokuMinimal)).length

  return (
    <div className="p-8">
      <PageHeader
        title="Produktet"
        subtitle={`${products.length} produkte gjithsej${lowStockCount > 0 ? ` · ${lowStockCount} me stok të ulët` : ''}`}
        action={
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <RiAddLine className="text-lg" />
            Shto Produkt
          </button>
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
        </div>
      </div>

      {/* Products Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Duke ngarkuar...</div>
        ) : products.length === 0 ? (
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
                {products.map((product, idx) => {
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
                        <span className="font-medium text-slate-900">{product.emri}</span>
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
                          <button
                            onClick={() => setDeleteModal(product)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Fshi"
                          >
                            <RiDeleteBin6Line className="text-lg" />
                          </button>
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
        onClose={() => setModalOpen(false)}
        title={editProduct ? 'Ndrysho Produkt' : 'Shto Produkt të Ri'}
        size="lg"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label">Emri i Produktit *</label>
            <input
              type="text"
              value={form.emri}
              onChange={(e) => setForm({ ...form, emri: e.target.value })}
              className="input"
              placeholder="p.sh. Bukë e Bardhë"
            />
          </div>

          {/* Multiple barcodes */}
          <div className="sm:col-span-2">
            <label className="label">Barkodi</label>
            <div className="space-y-2">
              {form.barcodes.map((bc, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={bc}
                    onChange={(e) => updateBarcode(idx, e.target.value)}
                    className="input font-mono flex-1"
                    placeholder="8001234567890"
                  />
                  {form.barcodes.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBarcode(idx)}
                      className="p-2 text-slate-300 hover:text-red-500 rounded-lg transition-colors flex-shrink-0"
                      title="Hiq barkod"
                    >
                      <RiCloseLine className="text-lg" />
                    </button>
                  )}
                </div>
              ))}
              {form.barcodes.length < 10 && (
                <button
                  type="button"
                  onClick={addBarcode}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 mt-0.5"
                >
                  <RiAddLine />
                  Shto barkod
                </button>
              )}
            </div>
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
            <label className="label">Çmimi i Blerjes (L) *</label>
            <input
              type="number"
              value={form.cmimiBlerjes}
              onChange={(e) => setForm({ ...form, cmimiBlerjes: e.target.value })}
              className="input"
              placeholder="0"
              min="0"
            />
          </div>
          <div>
            <label className="label">Çmimi i Shitjes (L) *</label>
            <input
              type="number"
              value={form.cmimiShitjes}
              onChange={(e) => setForm({ ...form, cmimiShitjes: e.target.value })}
              className="input"
              placeholder="0"
              min="0"
            />
          </div>
          <div>
            <label className="label">Sasia në Stok</label>
            <input
              type="number"
              value={form.sasia}
              onChange={(e) => setForm({ ...form, sasia: e.target.value })}
              className="input"
              min="0"
            />
          </div>
          <div>
            <label className="label">Stoku Minimal</label>
            <input
              type="number"
              value={form.stokuMinimal}
              onChange={(e) => setForm({ ...form, stokuMinimal: e.target.value })}
              className="input"
              min="0"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Furnitori</label>
            <select
              value={form.furnitorId}
              onChange={(e) => setForm({ ...form, furnitorId: e.target.value })}
              className="input"
            >
              <option value="">Pa furnitor</option>
              {suppliers.map((s) => (
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
          <button onClick={() => setModalOpen(false)} className="btn-secondary">
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
