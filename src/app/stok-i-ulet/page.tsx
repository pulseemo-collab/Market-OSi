'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import PageHeader from '@/components/ui/PageHeader'
import { RiAlertLine, RiRefreshLine, RiArrowUpLine } from 'react-icons/ri'

interface Product {
  id: number
  emri: string
  barcode: string | null
  kategoria: string
  sasia: number
  stokuMinimal: number
  njesia: string
  furnitor: { emri: string } | null
}

export default function StokUletPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/products?stokUlet=true')
      .then((r) => r.json())
      .then((data) => {
        const sorted = data.sort((a: Product, b: Product) => {
          const defA = a.sasia - a.stokuMinimal
          const defB = b.sasia - b.stokuMinimal
          return defA - defB
        })
        setProducts(sorted)
        setLoading(false)
      })
  }, [])

  function getReorderQty(product: Product): number {
    const targetStock = product.stokuMinimal * 3
    return Math.max(0, targetStock - product.sasia)
  }

  function getSeverity(product: Product): 'kritike' | 'mesatare' | 'e ulet' {
    if (product.sasia === 0) return 'kritike'
    const ratio = product.sasia / product.stokuMinimal
    if (ratio <= 0.5) return 'kritike'
    return 'e ulet'
  }

  const kritiket = products.filter((p) => getSeverity(p) === 'kritike')
  const tjerat = products.filter((p) => getSeverity(p) !== 'kritike')

  return (
    <div className="p-8">
      <PageHeader
        title="Stok i Ulët"
        subtitle={`${products.length} produkte nën nivelin minimal`}
        action={
          <button
            onClick={() => window.location.reload()}
            className="btn-secondary flex items-center gap-2"
          >
            <RiRefreshLine />
            Rifresko
          </button>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card p-4 border-l-4 border-red-500">
          <p className="text-xs font-medium text-slate-500 mb-1">Kritike (Stok 0)</p>
          <p className="text-2xl font-bold text-red-600">
            {products.filter((p) => p.sasia === 0).length}
          </p>
        </div>
        <div className="card p-4 border-l-4 border-orange-400">
          <p className="text-xs font-medium text-slate-500 mb-1">Stok Shumë i Ulët</p>
          <p className="text-2xl font-bold text-orange-500">
            {products.filter((p) => p.sasia > 0 && p.sasia <= p.stokuMinimal * 0.5).length}
          </p>
        </div>
        <div className="card p-4 border-l-4 border-yellow-400">
          <p className="text-xs font-medium text-slate-500 mb-1">Nën Minimalen</p>
          <p className="text-2xl font-bold text-yellow-600">
            {products.filter((p) => p.sasia > p.stokuMinimal * 0.5 && p.sasia <= p.stokuMinimal).length}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-slate-400">Duke ngarkuar...</div>
      ) : products.length === 0 ? (
        <div className="card p-12 text-center">
          <RiArrowUpLine className="text-4xl text-green-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-700 mb-1">Stoku është i mirë!</h3>
          <p className="text-sm text-slate-400">Të gjitha produktet janë mbi nivelin minimal</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <RiAlertLine className="text-orange-500" />
            <h2 className="font-semibold text-slate-900">Lista e Porosive të Rekomanduar</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="table-th">Produkti</th>
                  <th className="table-th">Kategoria</th>
                  <th className="table-th text-center">Stoku Aktual</th>
                  <th className="table-th text-center">Stoku Minimal</th>
                  <th className="table-th text-center">Deficit</th>
                  <th className="table-th text-center">Rekomandim Porosie</th>
                  <th className="table-th">Furnitori</th>
                  <th className="table-th text-center">Gjendja</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, idx) => {
                  const deficit = product.stokuMinimal - product.sasia
                  const reorder = getReorderQty(product)
                  const severity = getSeverity(product)
                  return (
                    <motion.tr
                      key={product.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.04 }}
                      className={`table-row ${product.sasia === 0 ? 'bg-red-50' : ''}`}
                    >
                      <td className="table-td">
                        <p className="font-medium text-slate-900">{product.emri}</p>
                        {product.barcode && (
                          <p className="text-xs text-slate-400 font-mono">{product.barcode}</p>
                        )}
                      </td>
                      <td className="table-td">
                        <span className="badge-gray">{product.kategoria}</span>
                      </td>
                      <td className="table-td text-center">
                        <span className={`font-bold text-base ${product.sasia === 0 ? 'text-red-600' : 'text-orange-500'}`}>
                          {product.sasia}
                        </span>
                        <span className="text-xs text-slate-400 ml-1">{product.njesia}</span>
                      </td>
                      <td className="table-td text-center text-slate-600">
                        {product.stokuMinimal} {product.njesia}
                      </td>
                      <td className="table-td text-center">
                        <span className="text-red-600 font-semibold">-{deficit}</span>
                      </td>
                      <td className="table-td text-center">
                        <span className="badge-blue font-semibold">
                          {reorder} {product.njesia}
                        </span>
                      </td>
                      <td className="table-td text-slate-500">
                        {product.furnitor?.emri || '—'}
                      </td>
                      <td className="table-td text-center">
                        {severity === 'kritike' ? (
                          <span className="badge-red">Kritike</span>
                        ) : (
                          <span className="badge-yellow">E Ulët</span>
                        )}
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {products.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
              <p className="text-xs text-slate-400">
                Rekomandimi i porositjes bazohet në formulën: Stoku Target (3× Minimumi) − Stoku Aktual
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
