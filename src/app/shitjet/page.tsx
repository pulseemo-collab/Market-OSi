'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  RiSearchLine,
  RiAddLine,
  RiSubtractLine,
  RiDeleteBin6Line,
  RiShoppingCartLine,
  RiPrinterLine,
  RiCheckLine,
} from 'react-icons/ri'

interface Product {
  id: number
  emri: string
  barcode: string | null
  kategoria: string
  sasia: number
  stokuMinimal: number
  cmimiBlerjes: number
  cmimiShitjes: number
  njesia: string
}

interface CartItem {
  product: Product
  sasia: number
}

interface CompletedSale {
  id: number
  totali: number
  fitimi: number
  createdAt: string
  items: Array<{
    emriProduktit: string
    sasia: number
    cmimiShitjes: number
    fitimi: number
  }>
}

export default function ShitjetPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
  const [kerkimi, setKerkimi] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [receiptModal, setReceiptModal] = useState<CompletedSale | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data) => {
        setProducts(data)
        setFilteredProducts(data)
      })
  }, [])

  const refreshProducts = useCallback(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data) => {
        setProducts(data)
      })
  }, [])

  useEffect(() => {
    if (kerkimi.trim() === '') {
      setFilteredProducts(products)
    } else {
      const q = kerkimi.toLowerCase()
      setFilteredProducts(
        products.filter(
          (p) =>
            p.emri.toLowerCase().includes(q) ||
            (p.barcode && p.barcode.includes(q)) ||
            p.kategoria.toLowerCase().includes(q)
        )
      )
    }
  }, [kerkimi, products])

  function addToCart(product: Product) {
    if (product.sasia <= 0) {
      toast.error(`${product.emri} - Stoku i mbaruar`)
      return
    }
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) {
        if (existing.sasia >= product.sasia) {
          toast.error(`Stoku i pamjaftueshëm: ${product.sasia} ${product.njesia}`)
          return prev
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, sasia: i.sasia + 1 } : i
        )
      }
      return [...prev, { product, sasia: 1 }]
    })
    setKerkimi('')
    searchRef.current?.focus()
  }

  function updateSasia(productId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item
          const newSasia = item.sasia + delta
          if (newSasia <= 0) return null
          if (newSasia > item.product.sasia) {
            toast.error(`Stoku maksimal: ${item.product.sasia}`)
            return item
          }
          return { ...item, sasia: newSasia }
        })
        .filter(Boolean) as CartItem[]
    )
  }

  function removeFromCart(productId: number) {
    setCart((prev) => prev.filter((i) => i.product.id !== productId))
  }

  function setQuantityDirectly(productId: number, value: number) {
    setCart((prev) =>
      prev.map((item) => {
        if (item.product.id !== productId) return item
        const clamped = Math.max(1, Math.min(Math.floor(value), item.product.sasia))
        if (value > item.product.sasia) {
          toast.error(`Stoku maksimal: ${item.product.sasia}`)
        }
        return { ...item, sasia: clamped }
      })
    )
  }

  const totali = cart.reduce((sum, i) => sum + i.product.cmimiShitjes * i.sasia, 0)
  const fitimi = cart.reduce(
    (sum, i) => sum + (i.product.cmimiShitjes - i.product.cmimiBlerjes) * i.sasia,
    0
  )

  async function completeSale() {
    if (cart.length === 0) {
      toast.error('Shporta është bosh')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((i) => ({
            productId: i.product.id,
            emriProduktit: i.product.emri,
            sasia: i.sasia,
            cmimiBlerjes: i.product.cmimiBlerjes,
            cmimiShitjes: i.product.cmimiShitjes,
          })),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Gabim gjatë shitjes')
        return
      }

      const sale = await res.json()
      setReceiptModal(sale)
      setCart([])
      refreshProducts()
      toast.success('Shitja u regjistrua me sukses!')
    } finally {
      setLoading(false)
    }
  }

  function printReceipt() {
    window.print()
  }

  return (
    <div className="grid h-full overflow-hidden grid-cols-[minmax(0,1fr)_550px]">
      {/* Left: Product Search */}
      <div className="flex flex-col border-r border-slate-200 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h1 className="text-xl font-bold text-slate-900 mb-4">Shitjet — POS</h1>
          <div className="relative">
            <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Kërko produkt ose barkod..."
              value={kerkimi}
              onChange={(e) => setKerkimi(e.target.value)}
              className="input pl-10 text-base"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredProducts.map((product) => {
              const inCart = cart.find((i) => i.product.id === product.id)
              const outOfStock = product.sasia <= 0
              return (
                <motion.button
                  key={product.id}
                  whileHover={!outOfStock ? { scale: 1.01 } : {}}
                  whileTap={!outOfStock ? { scale: 0.99 } : {}}
                  onClick={() => !outOfStock && addToCart(product)}
                  disabled={outOfStock}
                  className={`text-left p-4 rounded-xl border-2 transition-all ${
                    outOfStock
                      ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                      : inCart
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-slate-900 text-sm leading-tight">{product.emri}</p>
                    {inCart && (
                      <span className="badge-blue ml-1 flex-shrink-0">{inCart.sasia}</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mb-2">{product.kategoria}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-slate-900">
                      {formatCurrency(product.cmimiShitjes)}
                    </span>
                    <span className={`text-xs font-medium ${product.sasia <= product.stokuMinimal ? 'text-red-500' : 'text-slate-400'}`}>
                      Stoku: {product.sasia}
                    </span>
                  </div>
                </motion.button>
              )
            })}
          </div>
          {filteredProducts.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              Nuk u gjet asnjë produkt
            </div>
          )}
        </div>
      </div>

      {/* Right: Cart */}
      <div className="flex flex-col bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <RiShoppingCartLine className="text-xl text-slate-600" />
            <h2 className="font-semibold text-slate-900">Shporta</h2>
            {cart.length > 0 && (
              <span className="badge-blue ml-auto">{cart.length} produkte</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          <AnimatePresence>
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12">
                <RiShoppingCartLine className="text-5xl mb-3 text-slate-200" />
                <p className="text-sm">Shporta është bosh</p>
                <p className="text-xs mt-1">Klikoni mbi produkt për ta shtuar</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {cart.map((item) => (
                  <motion.div
                    key={item.product.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="px-4 py-3"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <p className="text-sm font-medium text-slate-800 leading-tight flex-1 pr-2">
                        {item.product.emri}
                      </p>
                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="text-slate-300 hover:text-red-500 transition-colors p-0.5"
                      >
                        <RiDeleteBin6Line />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateSasia(item.product.id, -1)}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors flex-shrink-0"
                        >
                          <RiSubtractLine className="text-sm" />
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={item.product.sasia}
                          value={item.sasia}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10)
                            if (!isNaN(val) && val >= 1) {
                              setQuantityDirectly(item.product.id, val)
                            }
                          }}
                          onClick={(e) => (e.target as HTMLInputElement).select()}
                          className="w-12 h-7 text-center text-sm font-semibold border border-slate-200 rounded-md focus:outline-none focus:border-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          onClick={() => updateSasia(item.product.id, 1)}
                          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors flex-shrink-0"
                        >
                          <RiAddLine className="text-sm" />
                        </button>
                      </div>
                      <span className="text-sm font-bold text-slate-900">
                        {formatCurrency(item.product.cmimiShitjes * item.sasia)}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Cart Summary */}
        <div className="border-t border-slate-200 p-4 space-y-3">
          <div className="flex justify-between text-sm text-slate-500">
            <span>Nën-totali</span>
            <span>{formatCurrency(totali)}</span>
          </div>
          <div className="flex justify-between text-sm text-green-600 font-medium">
            <span>Fitimi</span>
            <span>{formatCurrency(fitimi)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-100">
            <span>TOTALI</span>
            <span>{formatCurrency(totali)}</span>
          </div>
          <button
            onClick={completeSale}
            disabled={loading || cart.length === 0}
            className={`w-full py-3.5 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all ${
              cart.length === 0
                ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
            }`}
          >
            <RiCheckLine className="text-xl" />
            {loading ? 'Duke procesuar...' : 'Përfundo Shitjen'}
          </button>
          {cart.length > 0 && (
            <button
              onClick={() => setCart([])}
              className="w-full text-xs text-slate-400 hover:text-red-500 transition-colors py-1"
            >
              Pastro shportën
            </button>
          )}
        </div>
      </div>

      {/* Receipt Modal */}
      <Modal
        isOpen={!!receiptModal}
        onClose={() => setReceiptModal(null)}
        title="Fatura e Shitjes"
        size="sm"
      >
        {receiptModal && (
          <div>
            {/* Printable Receipt */}
            <div id="receipt" className="font-mono">
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold">MARKET OS</h2>
                <p className="text-xs text-slate-500">Sistemi i Marketit</p>
                <p className="text-xs text-slate-400 mt-1">{formatDateTime(receiptModal.createdAt)}</p>
                <p className="text-xs text-slate-400">Fatura #{receiptModal.id}</p>
              </div>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="space-y-1.5 mb-3">
                {receiptModal.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm">
                    <div className="flex-1">
                      <span className="font-medium">{item.emriProduktit}</span>
                      <span className="text-slate-400 text-xs ml-2">x{item.sasia}</span>
                    </div>
                    <span className="font-medium">{formatCurrency(item.cmimiShitjes * item.sasia)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-dashed border-slate-300 my-3" />
              <div className="flex justify-between font-bold text-base">
                <span>TOTALI</span>
                <span>{formatCurrency(receiptModal.totali)}</span>
              </div>
              <div className="text-center mt-4 text-xs text-slate-400">
                <p>Faleminderit për blerjen!</p>
              </div>
            </div>

            <div className="flex gap-3 mt-5 no-print">
              <button
                onClick={printReceipt}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <RiPrinterLine />
                Printo Faturën
              </button>
              <button
                onClick={() => setReceiptModal(null)}
                className="btn-primary flex-1"
              >
                Mbyll
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
