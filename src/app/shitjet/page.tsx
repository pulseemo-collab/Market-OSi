'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useRole } from '@/contexts/RoleContext'
import AccessDenied from '@/components/AccessDenied'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { formatCurrency, formatDateTime, toArray } from '@/lib/utils'
import {
  RiSearchLine,
  RiAddLine,
  RiSubtractLine,
  RiDeleteBin6Line,
  RiShoppingCartLine,
  RiPrinterLine,
  RiCheckLine,
  RiBarcodeLine,
} from 'react-icons/ri'

interface Product {
  id: number
  emri: string
  barcodes: { barcode: string }[]
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
    product: { njesia: string } | null
  }>
}

function isWeighted(njesia: string) {
  return njesia === 'kg' || njesia === 'gram' || njesia === 'litër'
}

export default function ShitjetPage() {
  const { role } = useRole()
  const [products, setProducts] = useState<Product[]>([])
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([])
  const [kerkimi, setKerkimi] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [loading, setLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(true)
  const [productsError, setProductsError] = useState(false)
  const [receiptModal, setReceiptModal] = useState<CompletedSale | null>(null)
  const [rawValues, setRawValues] = useState<Record<number, string>>({})
  const [barkodi, setBarkodi] = useState('')
  const [scanFlash, setScanFlash] = useState<'success' | 'error' | null>(null)
  const [scanMessage, setScanMessage] = useState('')
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products')
  const searchRef = useRef<HTMLInputElement>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const receiptModalRef = useRef<CompletedSale | null>(null)

  // Keep receiptModalRef in sync for the document click handler (avoids stale closure)
  useEffect(() => { receiptModalRef.current = receiptModal }, [receiptModal])

  // Refocus barcode when receipt modal is dismissed
  useEffect(() => {
    if (!receiptModal) {
      setTimeout(() => barcodeRef.current?.focus(), 100)
    }
  }, [receiptModal])

  // Return focus to barcode after any click that doesn't land on a real input
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (receiptModalRef.current) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select')) return
      setTimeout(() => {
        const active = document.activeElement
        if (!active || !['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) {
          barcodeRef.current?.focus()
        }
      }, 50)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  useEffect(() => {
    setProductsError(false)
    fetch('/api/products')
      .then((r) => {
        if (r.status === 401) { window.location.href = '/login'; return r }
        return r
      })
      .then((r) => r.json())
      .then((data) => {
        const arr = toArray<Product>(data, 'products')
        setProducts(arr)
        setFilteredProducts(arr)
      })
      .catch(() => {
        setProducts([])
        setFilteredProducts([])
        setProductsError(true)
      })
      .finally(() => setProductsLoading(false))
  }, [])

  const refreshProducts = useCallback(() => {
    fetch('/api/products')
      .then((r) => r.json())
      .then((data) => {
        setProducts(toArray<Product>(data, 'products'))
      })
      .catch(() => setProducts([]))
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
            p.barcodes.some((b) => b.barcode.includes(q)) ||
            p.kategoria.toLowerCase().includes(q)
        )
      )
    }
  }, [kerkimi, products])

  // O(1) barcode lookup — rebuilt only when product list changes
  const barcodeMap = useMemo(() => {
    const map = new Map<string, Product>()
    for (const p of products) {
      for (const b of p.barcodes) {
        if (b.barcode) map.set(b.barcode.trim(), p)
      }
    }
    return map
  }, [products])

  function playBeep(type: 'success' | 'error') {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      if (type === 'success') {
        osc.type = 'sine'
        osc.frequency.value = 1480
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.12)
      } else {
        osc.type = 'sawtooth'
        osc.frequency.value = 320
        gain.gain.setValueAtTime(0.07, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.28)
      }
    } catch {
      // Audio API blocked or unavailable — silent fallback
    }
  }

  function vibrateDevice(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern)
    } catch {
      // Vibration API not supported — ignore
    }
  }

  function triggerFlash(type: 'success' | 'error', message: string, duration = 1000) {
    setScanFlash(type)
    setScanMessage(message)
    playBeep(type)
    vibrateDevice(type === 'success' ? 50 : [80, 50, 80])
    setTimeout(() => {
      setScanFlash(null)
      setScanMessage('')
    }, duration)
  }

  function handleBarcodeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()

    const code = barkodi.trim()
    setBarkodi('')

    if (!code) return

    const product = barcodeMap.get(code)

    if (!product) {
      triggerFlash('error', 'Produkti nuk u gjet', 1500)
      barcodeRef.current?.focus()
      return
    }

    if (product.sasia <= 0) {
      toast.error(`${product.emri} — Stoku i mbaruar`)
      triggerFlash('error', 'Stoku i mbaruar', 1500)
      barcodeRef.current?.focus()
      return
    }

    const step = isWeighted(product.njesia) ? 1.0 : 1
    const currentInCart = cart.find((i) => i.product.id === product.id)
    const newSasia = currentInCart
      ? parseFloat((currentInCart.sasia + step).toFixed(3))
      : isWeighted(product.njesia)
        ? parseFloat(Math.min(1.0, product.sasia).toFixed(3))
        : 1

    if (newSasia > product.sasia) {
      toast.error(`Stoku i pamjaftueshëm: ${product.sasia} ${product.njesia}`)
      triggerFlash('error', `Stoku maks: ${product.sasia} ${product.njesia}`, 1500)
      barcodeRef.current?.focus()
      return
    }

    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, sasia: newSasia } : i
        )
      }
      return [...prev, { product, sasia: newSasia }]
    })
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[product.id]
      return next
    })

    triggerFlash('success', `${product.emri} u shtua`, 900)
    barcodeRef.current?.focus()
  }

  function addToCart(product: Product) {
    if (product.sasia <= 0) {
      toast.error(`${product.emri} - Stoku i mbaruar`)
      return
    }
    const step = isWeighted(product.njesia) ? 0.250 : 1
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id)
      if (existing) {
        const newSasia = parseFloat((existing.sasia + step).toFixed(3))
        if (newSasia > product.sasia) {
          toast.error(`Stoku i pamjaftueshëm: ${product.sasia} ${product.njesia}`)
          return prev
        }
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, sasia: newSasia } : i
        )
      }
      const initialSasia = isWeighted(product.njesia)
        ? parseFloat(Math.min(1.0, product.sasia).toFixed(3))
        : 1
      return [...prev, { product, sasia: initialSasia }]
    })
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[product.id]
      return next
    })
    setKerkimi('')
    barcodeRef.current?.focus()
  }

  function updateSasia(productId: number, delta: number) {
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item
          const newSasia = parseFloat((item.sasia + delta).toFixed(3))
          if (newSasia <= 0) return null
          if (newSasia > item.product.sasia) {
            toast.error(`Stoku maksimal: ${item.product.sasia} ${item.product.njesia}`)
            return item
          }
          return { ...item, sasia: newSasia }
        })
        .filter(Boolean) as CartItem[]
    )
  }

  function removeFromCart(productId: number) {
    setRawValues((prev) => {
      const next = { ...prev }
      delete next[productId]
      return next
    })
    setCart((prev) => prev.filter((i) => i.product.id !== productId))
  }

  function handleQuantityInput(item: CartItem, inputStr: string) {
    if (isWeighted(item.product.njesia)) {
      if (!/^(\d*\.?\d{0,3})?$/.test(inputStr)) return
    } else {
      if (!/^\d*$/.test(inputStr)) return
    }
    setRawValues((prev) => ({ ...prev, [item.product.id]: inputStr }))
    const parsed = parseFloat(inputStr)
    if (isNaN(parsed) || parsed <= 0) return
    if (isWeighted(item.product.njesia)) {
      if (parsed > item.product.sasia) {
        toast.error(`Stoku maksimal: ${item.product.sasia} ${item.product.njesia}`)
      }
      const val = parseFloat(Math.min(parsed, item.product.sasia).toFixed(3))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
    } else {
      const val = Math.max(1, Math.min(Math.floor(parsed), item.product.sasia))
      if (Math.floor(parsed) > item.product.sasia) {
        toast.error(`Stoku maksimal: ${item.product.sasia}`)
      }
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
    }
  }

  function handleQuantityBlur(item: CartItem) {
    const raw = rawValues[item.product.id]
    if (raw === undefined) return
    const parsed = parseFloat(raw)
    if (isWeighted(item.product.njesia)) {
      const val = (isNaN(parsed) || parsed <= 0)
        ? 0.001
        : parseFloat(Math.min(parsed, item.product.sasia).toFixed(3))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
      setRawValues((prev) => ({ ...prev, [item.product.id]: val.toFixed(3) }))
    } else {
      const val = (isNaN(parsed) || parsed < 1)
        ? 1
        : Math.max(1, Math.min(Math.floor(parsed), item.product.sasia))
      setCart((prev) => prev.map((i) => i.product.id === item.product.id ? { ...i, sasia: val } : i))
      setRawValues((prev) => {
        const next = { ...prev }
        delete next[item.product.id]
        return next
      })
    }
  }

  function getDisplayValue(item: CartItem): string {
    const raw = rawValues[item.product.id]
    if (raw !== undefined) return raw
    return isWeighted(item.product.njesia) ? item.sasia.toFixed(3) : item.sasia.toString()
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

  if (!role || !['admin', 'cashier'].includes(role)) return <AccessDenied />

  return (
    <div className="flex flex-col h-full">
      {/* ── Mobile tab bar ── */}
      <div className="lg:hidden flex items-center border-b border-slate-200 bg-white flex-shrink-0">
        <button
          onClick={() => setMobileTab('products')}
          className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
            mobileTab === 'products'
              ? 'text-blue-600 border-blue-600'
              : 'text-slate-500 border-transparent'
          }`}
        >
          Produktet
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-3.5 text-sm font-semibold transition-colors border-b-2 -mb-px flex items-center justify-center gap-2 ${
            mobileTab === 'cart'
              ? 'text-blue-600 border-blue-600'
              : 'text-slate-500 border-transparent'
          }`}
        >
          Shporta
          {cart.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 bg-blue-600 text-white text-xs font-bold rounded-full">
              {cart.length}
            </span>
          )}
        </button>
      </div>

      {/* ── Content area ── */}
      <div className="flex-1 min-h-0 overflow-hidden flex lg:grid lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_500px]">

        {/* ── Left: Product Search ── */}
        <div
          className={`flex-col overflow-hidden border-r border-slate-200 w-full lg:w-auto ${
            mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">Shitjet — POS</h1>

            {/* Barcode Scanner Input */}
            <div>
              <div className="relative">
                <RiBarcodeLine
                  className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-xl transition-colors duration-200 ${
                    scanFlash === 'success'
                      ? 'text-green-500'
                      : scanFlash === 'error'
                      ? 'text-red-400'
                      : 'text-slate-400'
                  }`}
                />
                <input
                  ref={barcodeRef}
                  type="text"
                  placeholder="Skano ose shkruaj barkodin..."
                  value={barkodi}
                  onChange={(e) => setBarkodi(e.target.value)}
                  onKeyDown={handleBarcodeKeyDown}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className={`w-full pl-10 pr-10 py-2.5 text-sm font-medium rounded-xl border-2 transition-all duration-200 outline-none ${
                    scanFlash === 'success'
                      ? 'border-green-400 bg-green-50 text-green-800 placeholder-green-300'
                      : scanFlash === 'error'
                      ? 'border-red-400 bg-red-50 text-red-800 placeholder-red-300'
                      : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:border-blue-400'
                  }`}
                />
                <AnimatePresence mode="wait">
                  {scanFlash === 'success' && (
                    <motion.span
                      key="ok"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-green-500"
                    >
                      <RiCheckLine className="text-xl" />
                    </motion.span>
                  )}
                  {scanFlash === 'error' && (
                    <motion.span
                      key="err"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-red-400 text-lg font-bold leading-none"
                    >
                      ✗
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <AnimatePresence>
                {scanMessage && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`text-xs mt-1.5 font-medium pl-1 ${
                      scanFlash === 'success' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {scanMessage}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Product Name / Category Search */}
            <div className="relative">
              <RiSearchLine className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Kërko produkt sipas emrit ose kategorisë..."
                value={kerkimi}
                onChange={(e) => setKerkimi(e.target.value)}
                className="input pl-10 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {productsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 animate-pulse">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-28 bg-slate-100 rounded-xl" />
                ))}
              </div>
            ) : productsError ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 py-12 gap-3">
                <p className="text-sm font-medium text-slate-500">Gabim gjatë ngarkimit</p>
                <button
                  onClick={() => window.location.reload()}
                  className="btn-secondary text-xs"
                >
                  Provo Sërish
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
                {filteredProducts.map((product) => {
                  const inCart = cart.find((i) => i.product.id === product.id)
                  const outOfStock = product.sasia <= 0
                  return (
                    <motion.button
                      key={product.id}
                      whileHover={!outOfStock ? { scale: 1.01 } : {}}
                      whileTap={!outOfStock ? { scale: 0.98 } : {}}
                      onClick={() => !outOfStock && addToCart(product)}
                      disabled={outOfStock}
                      className={`text-left p-3 sm:p-4 rounded-xl border-2 transition-all min-h-[5rem] ${
                        outOfStock
                          ? 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                          : inCart
                          ? 'border-blue-400 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-sm active:scale-95'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1.5 sm:mb-2">
                        <p className="font-medium text-slate-900 text-xs sm:text-sm leading-tight">{product.emri}</p>
                        {inCart && (
                          <span className="badge-blue ml-1 flex-shrink-0 text-xs">
                            {isWeighted(product.njesia) ? inCart.sasia.toFixed(3) : inCart.sasia}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mb-1.5 sm:mb-2 truncate">{product.kategoria}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm sm:text-base font-bold text-slate-900">
                          {formatCurrency(product.cmimiShitjes)}
                        </span>
                        <span className={`text-xs font-medium hidden sm:block ${product.sasia <= product.stokuMinimal ? 'text-red-500' : 'text-slate-400'}`}>
                          {isWeighted(product.njesia) ? product.sasia.toFixed(3) : product.sasia} {product.njesia}
                        </span>
                      </div>
                    </motion.button>
                  )
                })}
                {filteredProducts.length === 0 && kerkimi && (
                  <div className="col-span-full text-center py-12 text-slate-400">
                    Nuk u gjet asnjë produkt
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Cart ── */}
        <div
          className={`flex-col bg-white overflow-hidden w-full lg:w-auto ${
            mobileTab === 'products' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="px-4 sm:px-5 py-4 border-b border-slate-100">
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
                <div className="flex flex-col items-center justify-center h-full text-slate-400 py-16">
                  <RiShoppingCartLine className="text-5xl mb-3 text-slate-200" />
                  <p className="text-sm">Shporta është bosh</p>
                  <p className="text-xs mt-1">Skanoni barkod ose klikoni mbi produkt</p>
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
                      className="px-4 py-3 sm:px-4"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <p className="text-sm font-medium text-slate-800 leading-tight flex-1 pr-2">
                          {item.product.emri}
                        </p>
                        <button
                          onClick={() => removeFromCart(item.product.id)}
                          className="text-slate-300 hover:text-red-500 transition-colors p-1 -m-1"
                        >
                          <RiDeleteBin6Line className="text-lg" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updateSasia(item.product.id, isWeighted(item.product.njesia) ? -0.250 : -1)}
                            className="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center transition-colors flex-shrink-0"
                          >
                            <RiSubtractLine className="text-sm" />
                          </button>
                          <input
                            type="text"
                            inputMode={isWeighted(item.product.njesia) ? 'decimal' : 'numeric'}
                            value={getDisplayValue(item)}
                            onChange={(e) => handleQuantityInput(item, e.target.value)}
                            onFocus={(e) => {
                              setRawValues((prev) => ({
                                ...prev,
                                [item.product.id]: isWeighted(item.product.njesia)
                                  ? item.sasia.toFixed(3)
                                  : item.sasia.toString(),
                              }))
                              e.target.select()
                            }}
                            onBlur={() => handleQuantityBlur(item)}
                            className="w-20 h-9 lg:h-7 text-center text-sm font-semibold border border-slate-200 rounded-md focus:outline-none focus:border-blue-400"
                          />
                          <span className="text-xs text-slate-400 min-w-[2rem]">{item.product.njesia}</span>
                          <button
                            onClick={() => updateSasia(item.product.id, isWeighted(item.product.njesia) ? 0.250 : 1)}
                            className="w-9 h-9 lg:w-8 lg:h-8 rounded-lg bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center transition-colors flex-shrink-0"
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
          <div className="border-t border-slate-200 p-4 sm:p-5 space-y-3 bg-white">
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
              className={`w-full py-4 rounded-xl font-semibold text-base flex items-center justify-center gap-2 transition-all ${
                cart.length === 0
                  ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm'
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

      </div>{/* ── end content area ── */}

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
                      <span className="text-slate-400 text-xs ml-2">
                        {isWeighted(item.product?.njesia || '')
                          ? item.sasia.toFixed(3)
                          : item.sasia}{' '}
                        {item.product?.njesia || ''}
                      </span>
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
