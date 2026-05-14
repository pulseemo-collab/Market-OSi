'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { toArray } from '@/lib/utils'
import CardSkeleton from '@/components/ui/CardSkeleton'
import ErrorState from '@/components/ui/ErrorState'
import {
  RiAddLine,
  RiEditLine,
  RiDeleteBin6Line,
  RiPhoneLine,
  RiMailLine,
  RiMapPinLine,
  RiTruckLine,
} from 'react-icons/ri'

interface Product {
  id: number
  emri: string
}

interface Supplier {
  id: number
  emri: string
  telefoni: string | null
  email: string | null
  adresa: string | null
  shenime: string | null
  createdAt: string
  products: Product[]
}

const emptyForm = {
  emri: '',
  telefoni: '',
  email: '',
  adresa: '',
  shenime: '',
}

export default function FurnitoretPage() {
  const { role } = useRole()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteModal, setDeleteModal] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const fetchSuppliers = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/suppliers')
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSuppliers(toArray<Supplier>(data, 'suppliers'))
    } catch {
      setError(true)
      toast.error('Gabim gjatë ngarkimit')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  function openAdd() {
    setEditSupplier(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(supplier: Supplier) {
    setEditSupplier(supplier)
    setForm({
      emri: supplier.emri,
      telefoni: supplier.telefoni ?? '',
      email: supplier.email ?? '',
      adresa: supplier.adresa ?? '',
      shenime: supplier.shenime ?? '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.emri.trim()) {
      toast.error('Emri i furnitorit është i detyrueshëm')
      return
    }
    setSaving(true)
    try {
      const url = editSupplier
        ? `/api/suppliers/${editSupplier.id}`
        : '/api/suppliers'
      const method = editSupplier ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        toast.error('Gabim gjatë ruajtjes')
        return
      }
      toast.success(editSupplier ? 'Furnitori u përditësua' : 'Furnitori u shtua')
      setModalOpen(false)
      fetchSuppliers()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(supplier: Supplier) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/suppliers/${supplier.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Furnitori u fshi')
        setDeleteModal(null)
        fetchSuppliers()
      } else {
        toast.error('Gabim gjatë fshirjes')
      }
    } catch {
      toast.error('Gabim gjatë fshirjes')
    } finally {
      setDeleting(false)
    }
  }

  if (!role || !['admin', 'staff'].includes(role)) return <AccessDenied />

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Furnitorët"
        subtitle={`${suppliers.length} furnitorë të regjistruar`}
        action={
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <RiAddLine className="text-lg" />
            Shto Furnitor
          </button>
        }
      />

      {loading ? (
        <CardSkeleton count={6} />
      ) : error ? (
        <div className="card"><ErrorState message="Gabim gjatë ngarkimit të furnitorëve" onRetry={fetchSuppliers} /></div>
      ) : suppliers.length === 0 ? (
        <div className="card p-12 text-center">
          <RiTruckLine className="text-4xl text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 mb-3">Nuk ka furnitorë të regjistruar</p>
          <button onClick={openAdd} className="btn-primary">Shto Furnitor</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {suppliers.map((supplier, idx) => (
            <motion.div
              key={supplier.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06 }}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                    <RiTruckLine className="text-blue-600 text-xl" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{supplier.emri}</h3>
                    <p className="text-xs text-slate-400">
                      {supplier.products.length} produkte
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEdit(supplier)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  >
                    <RiEditLine />
                  </button>
                  <button
                    onClick={() => setDeleteModal(supplier)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <RiDeleteBin6Line />
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {supplier.telefoni && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <RiPhoneLine className="text-slate-400 flex-shrink-0" />
                    <span>{supplier.telefoni}</span>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <RiMailLine className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{supplier.email}</span>
                  </div>
                )}
                {supplier.adresa && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <RiMapPinLine className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{supplier.adresa}</span>
                  </div>
                )}
              </div>

              {supplier.products.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-400 mb-1.5">Produktet:</p>
                  <div className="flex flex-wrap gap-1">
                    {supplier.products.slice(0, 4).map((p) => (
                      <span key={p.id} className="badge-gray text-xs">{p.emri}</span>
                    ))}
                    {supplier.products.length > 4 && (
                      <span className="badge-blue text-xs">+{supplier.products.length - 4}</span>
                    )}
                  </div>
                </div>
              )}

              {supplier.shenime && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500 italic">{supplier.shenime}</p>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editSupplier ? 'Ndrysho Furnitorin' : 'Shto Furnitor të Ri'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Emri i Furnitorit *</label>
            <input
              type="text"
              value={form.emri}
              onChange={(e) => setForm({ ...form, emri: e.target.value })}
              className="input"
              placeholder="p.sh. Distribucioni Tirana"
            />
          </div>
          <div>
            <label className="label">Telefoni</label>
            <input
              type="tel"
              value={form.telefoni}
              onChange={(e) => setForm({ ...form, telefoni: e.target.value })}
              className="input"
              placeholder="+355 69 000 0000"
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="input"
              placeholder="info@furnitori.al"
            />
          </div>
          <div>
            <label className="label">Adresa</label>
            <input
              type="text"
              value={form.adresa}
              onChange={(e) => setForm({ ...form, adresa: e.target.value })}
              className="input"
              placeholder="Rruga, Qyteti"
            />
          </div>
          <div>
            <label className="label">Shënime</label>
            <textarea
              value={form.shenime}
              onChange={(e) => setForm({ ...form, shenime: e.target.value })}
              className="input resize-none"
              rows={3}
              placeholder="Shënime shtesë..."
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex-1"
            >
              {saving ? 'Duke ruajtur...' : editSupplier ? 'Ruaj Ndryshimet' : 'Shto Furnitor'}
            </button>
            <button onClick={() => setModalOpen(false)} className="btn-secondary">
              Anulo
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => !deleting && setDeleteModal(null)}
        title="Konfirmo Fshirjen"
        size="sm"
      >
        <p className="text-slate-600 mb-5">
          Jeni i sigurt që dëshironi të fshini furnitorin{' '}
          <strong className="text-slate-900">{deleteModal?.emri}</strong>?
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => deleteModal && handleDelete(deleteModal)}
            disabled={deleting}
            className="btn-danger flex-1"
          >
            {deleting ? 'Duke fshirë...' : 'Po, Fshi'}
          </button>
          <button onClick={() => setDeleteModal(null)} disabled={deleting} className="btn-secondary">
            Anulo
          </button>
        </div>
      </Modal>
    </div>
  )
}
