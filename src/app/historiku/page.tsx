'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import { RiReceiptLine, RiArrowDownLine, RiDeleteBin6Line } from 'react-icons/ri'

interface SaleItem {
  id: number
  emriProduktit: string
  sasia: number
  cmimiBlerjes: number
  cmimiShitjes: number
  fitimi: number
}

interface Sale {
  id: number
  totali: number
  fitimi: number
  shenime: string | null
  createdAt: string
  items: SaleItem[]
}

const PERIUDHAT = [
  { value: 'sot', label: 'Sot' },
  { value: 'dje', label: 'Dje' },
  { value: 'jave', label: 'Kjo Javë' },
  { value: 'muaj', label: 'Ky Muaj' },
]

export default function HistorikuPage() {
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [periudha, setPeriudha] = useState('sot')
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const [saleToDelete, setSaleToDelete] = useState<Sale | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchSales = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/sales?periudha=${periudha}`)
    const data = await res.json()
    setSales(data)
    setLoading(false)
  }, [periudha])

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

  const totaliPeriudhes = sales.reduce((sum, s) => sum + s.totali, 0)
  const fiitimiPeriudhes = sales.reduce((sum, s) => sum + s.fitimi, 0)

  return (
    <div className="p-8">
      <PageHeader
        title="Historiku i Shitjeve"
        subtitle={`${sales.length} shitje gjatë periudhës`}
      />

      {/* Period Filter */}
      <div className="flex gap-2 mb-6">
        {PERIUDHAT.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriudha(p.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              periudha === p.value
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {sales.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="card p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Shitjet Totale</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrency(totaliPeriudhes)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Fitimi Total</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(fiitimiPeriudhes)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs font-medium text-slate-500 mb-1">Numri i Shitjeve</p>
            <p className="text-xl font-bold text-slate-900">{sales.length}</p>
          </div>
        </div>
      )}

      {/* Sales Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">Duke ngarkuar...</div>
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
                  <th className="table-th text-right">Totali</th>
                  <th className="table-th text-right">Fitimi</th>
                  <th className="table-th text-center">Detaje</th>
                  <th className="table-th text-center">Fshi</th>
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
                    <td className="table-td text-right font-semibold text-slate-900">
                      {formatCurrency(sale.totali)}
                    </td>
                    <td className="table-td text-right font-semibold text-green-700">
                      {formatCurrency(sale.fitimi)}
                    </td>
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
                        onClick={() => setSaleToDelete(sale)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Fshi faturën"
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
    </div>
  )
}
