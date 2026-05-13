'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { RiDownloadLine } from 'react-icons/ri'

interface ExportButtonsProps {
  periudha: string
  nga?: string
  deri?: string
}

export default function ExportButtons({ periudha, nga, deri }: ExportButtonsProps) {
  const [loadingPDF, setLoadingPDF] = useState(false)
  const [loadingExcel, setLoadingExcel] = useState(false)

  const fetchData = async () => {
    const params = new URLSearchParams({ periudha })
    if (nga) params.set('nga', nga)
    if (deri) params.set('deri', deri)
    const res = await fetch('/api/export?' + params.toString())
    if (!res.ok) throw new Error('Gabim gjate ngarkimit')
    return res.json()
  }

  const handlePDF = async () => {
    setLoadingPDF(true)
    try {
      const data = await fetchData()
      const { exportPDF } = await import('@/lib/export')
      await exportPDF(data)
      toast.success('PDF u gjenerua me sukses')
    } catch {
      toast.error('Gabim gjate gjenerimit te PDF')
    } finally {
      setLoadingPDF(false)
    }
  }

  const handleExcel = async () => {
    setLoadingExcel(true)
    try {
      const data = await fetchData()
      const { exportExcel } = await import('@/lib/export')
      await exportExcel(data)
      toast.success('Excel u gjenerua me sukses')
    } catch {
      toast.error('Gabim gjate gjenerimit te Excel')
    } finally {
      setLoadingExcel(false)
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={handlePDF}
        disabled={loadingPDF || loadingExcel}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RiDownloadLine className={loadingPDF ? 'animate-bounce' : ''} />
        {loadingPDF ? 'Duke gjeneruar...' : 'Eksporto PDF'}
      </button>
      <button
        onClick={handleExcel}
        disabled={loadingPDF || loadingExcel}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <RiDownloadLine className={loadingExcel ? 'animate-bounce' : ''} />
        {loadingExcel ? 'Duke gjeneruar...' : 'Eksporto Excel'}
      </button>
    </div>
  )
}
