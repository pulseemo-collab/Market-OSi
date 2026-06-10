// Client-side only — all heavy imports are dynamic to prevent SSR bundling

export interface ExportData {
  orgName?: string | null
  periudhaLabel: string
  nga?: string | null
  deri?: string | null
  summary: {
    totali: number
    fitimi: number
    numriShitjeve: number
    marzhi: number
  }
  shitjet: Array<{
    id: number
    createdAt: string
    totali: number
    fitimi: number
    items: Array<{
      emriProduktit: string
      sasia: number
      cmimiShitjes: number
      fitimi: number
    }>
  }>
  produktet: Array<{
    emri: string
    kategoria: string
    sasia: number
    stokuMinimal: number
    cmimiBlerjes: number
    cmimiShitjes: number
    njesia: string
    furnitor?: { emri: string } | null
  }>
  stokUlet: Array<{
    emri: string
    kategoria: string
    sasia: number
    stokuMinimal: number
  }>
  furnizimet: Array<{
    id: number
    createdAt: string
    data: string
    totali: number
    furnitor?: { emri: string } | null
    items: Array<{
      emriProduktit: string
      sasia: number
      njesia: string
      cmimiBlerjes: number
      totali: number
    }>
  }>
}

function fmt(amount: number): string {
  return `${amount.toFixed(0)} L`
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function fmtDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('sq-AL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function safeFilename(label: string): string {
  return label
    .toLowerCase()
    .replace(/ë/g, 'e')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, '-')
}

export async function exportPDF(data: ExportData): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 15
  const contentW = pageW - 2 * margin
  const now = new Date()
  const genDate = fmtDateTime(now.toISOString())
  let y = 0

  // ── Blue header bar ──────────────────────────────────────
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pageW, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text(data.orgName || 'Market OS', margin, 12)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text('Raport Biznesi', margin, 20)
  doc.text('Periudha: ' + data.periudhaLabel, margin, 27)

  doc.setFontSize(8)
  doc.text('Gjeneruar: ' + genDate, pageW - margin, 27, { align: 'right' })
  if (data.nga && data.deri) {
    doc.text(data.nga + ' - ' + data.deri, pageW - margin, 20, { align: 'right' })
  }

  y = 38

  // ── Summary box ──────────────────────────────────────────
  doc.setDrawColor(226, 232, 240)
  doc.setFillColor(248, 250, 252)
  doc.roundedRect(margin, y, contentW, 26, 2, 2, 'FD')

  const col1 = margin + 8
  const col2 = margin + contentW / 2 + 8

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(100, 116, 139)
  doc.text('PERMBLEDHJE', col1, y + 6)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('Shitjet Totale:', col1, y + 14)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(37, 99, 235)
  doc.text(fmt(data.summary.totali), col1 + 36, y + 14)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('Fitimi Total:', col2, y + 14)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(5, 150, 105)
  doc.text(fmt(data.summary.fitimi), col2 + 30, y + 14)

  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 41, 59)
  doc.text('Nr. Shitjeve:', col1, y + 22)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(30, 41, 59)
  doc.text(String(data.summary.numriShitjeve), col1 + 36, y + 22)

  doc.setFont('helvetica', 'bold')
  doc.text('Marzhi:', col2, y + 22)
  doc.setFont('helvetica', 'normal')
  doc.text(data.summary.marzhi.toFixed(1) + '%', col2 + 30, y + 22)

  y += 33

  // ── Sales table ──────────────────────────────────────────
  if (data.shitjet.length > 0) {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('SHITJET', margin, y)
    y += 2

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['#', 'Data & Ora', 'Produktet', 'Totali', 'Fitimi']],
      body: data.shitjet.map((s) => [
        '#' + s.id,
        fmtDateTime(s.createdAt),
        s.items
          .slice(0, 3)
          .map((i) => i.emriProduktit + ' x' + i.sasia)
          .join(', ') + (s.items.length > 3 ? ' +' + (s.items.length - 3) : ''),
        fmt(s.totali),
        fmt(s.fitimi),
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 14, halign: 'center' },
        1: { cellWidth: 34 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 22, halign: 'right' },
        4: { cellWidth: 22, halign: 'right' },
      },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8
  } else {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184)
    doc.text('Nuk ka shitje per kete periudhe.', margin, y + 6)
    y += 14
  }

  // ── Low stock table ──────────────────────────────────────
  if (data.stokUlet.length > 0) {
    if (y > 230) {
      doc.addPage()
      y = margin
    }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('STOK I ULET', margin, y)
    y += 2

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Produkti', 'Kategoria', 'Stoku', 'Min.', 'Deficit']],
      body: data.stokUlet.map((p) => [
        p.emri,
        p.kategoria,
        String(p.sasia),
        String(p.stokuMinimal),
        String(p.stokuMinimal - p.sasia),
      ]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: {
        fillColor: [220, 38, 38],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: [254, 242, 242] },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = ((doc as any).lastAutoTable?.finalY ?? y) + 8
  }

  // ── Footer on every page ─────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  const pageH = doc.internal.pageSize.getHeight()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(148, 163, 184)
    doc.setFont('helvetica', 'normal')
    doc.text(
      (data.orgName || 'Market OS') + '  •  Faqe ' + i + ' / ' + pageCount + '  •  ' + genDate,
      pageW / 2,
      pageH - 7,
      { align: 'center' }
    )
  }

  const date = now.toISOString().slice(0, 10)
  doc.save('raport-' + safeFilename(data.periudhaLabel) + '-' + date + '.pdf')
}

export async function exportExcel(data: ExportData): Promise<void> {
  const XLSX = await import('xlsx')

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Shitjet ────────────────────────────────────
  const shitjetRows: (string | number)[][] = [
    ['#', 'Data', 'Ora', 'Produktet', 'Njesi Totale', 'Totali (L)', 'Fitimi (L)', 'Marzhi %'],
    ...data.shitjet.map((s) => {
      const d = new Date(s.createdAt)
      const njesiTotale = s.items.reduce((sum, i) => sum + i.sasia, 0)
      const produktetStr = s.items.map((i) => i.emriProduktit + ' x' + i.sasia).join('; ')
      return [
        s.id,
        d.toLocaleDateString('sq-AL'),
        d.toLocaleTimeString('sq-AL', { hour: '2-digit', minute: '2-digit' }),
        produktetStr,
        njesiTotale,
        s.totali,
        s.fitimi,
        s.totali > 0 ? parseFloat(((s.fitimi / s.totali) * 100).toFixed(1)) : 0,
      ]
    }),
  ]
  const wsShitjet = XLSX.utils.aoa_to_sheet(shitjetRows)
  wsShitjet['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 8 }, { wch: 55 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, wsShitjet, 'Shitjet')

  // ── Sheet 2: Produktet ──────────────────────────────────
  const produktetRows: (string | number)[][] = [
    ['Emri', 'Kategoria', 'Stoku', 'Stok Minimal', 'Cmimi Blerjes', 'Cmimi Shitjes', 'Njesia', 'Furnitori', 'Marzhi %'],
    ...data.produktet.map((p) => [
      p.emri,
      p.kategoria,
      p.sasia,
      p.stokuMinimal,
      p.cmimiBlerjes,
      p.cmimiShitjes,
      p.njesia,
      p.furnitor?.emri || '',
      p.cmimiShitjes > 0
        ? parseFloat((((p.cmimiShitjes - p.cmimiBlerjes) / p.cmimiShitjes) * 100).toFixed(1))
        : 0,
    ]),
  ]
  const wsProdukte = XLSX.utils.aoa_to_sheet(produktetRows)
  wsProdukte['!cols'] = [
    { wch: 30 }, { wch: 15 }, { wch: 8 }, { wch: 13 },
    { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 22 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, wsProdukte, 'Produktet')

  // ── Sheet 3: Stok i Ulet ────────────────────────────────
  const stokRows: (string | number)[][] = [
    ['Produkti', 'Kategoria', 'Stoku Aktual', 'Stoku Minimal', 'Deficit', 'Sugjerim Porosi'],
    ...data.stokUlet.map((p) => {
      const deficit = p.stokuMinimal - p.sasia
      const sugjerim = Math.max(0, p.stokuMinimal * 3 - p.sasia)
      return [p.emri, p.kategoria, p.sasia, p.stokuMinimal, deficit, sugjerim]
    }),
  ]
  const wsStok = XLSX.utils.aoa_to_sheet(stokRows)
  wsStok['!cols'] = [
    { wch: 30 }, { wch: 15 }, { wch: 13 }, { wch: 14 }, { wch: 10 }, { wch: 17 },
  ]
  XLSX.utils.book_append_sheet(wb, wsStok, 'Stok i Ulet')

  // ── Sheet 4: Furnizimet ─────────────────────────────────
  const furnizimetRows: (string | number)[][] = [
    ['#', 'Data', 'Furnitori', 'Produktet', 'Totali (L)'],
    ...data.furnizimet.map((f) => [
      f.id,
      fmtDate(f.data || f.createdAt),
      f.furnitor?.emri || 'Pa furnitor',
      f.items.map((i) => i.emriProduktit + ' x' + i.sasia + ' ' + i.njesia).join('; '),
      f.totali,
    ]),
  ]
  const wsFurnizime = XLSX.utils.aoa_to_sheet(furnizimetRows)
  wsFurnizime['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 22 }, { wch: 60 }, { wch: 12 },
  ]
  XLSX.utils.book_append_sheet(wb, wsFurnizime, 'Furnizimet')

  // ── Sheet 5: Fitimi (per day) ────────────────────────────
  const fitimiByDate = new Map<string, { shitjet: number; fitimi: number; count: number }>()
  for (const s of data.shitjet) {
    const key = new Date(s.createdAt).toLocaleDateString('sq-AL')
    const entry = fitimiByDate.get(key) || { shitjet: 0, fitimi: 0, count: 0 }
    entry.shitjet += s.totali
    entry.fitimi += s.fitimi
    entry.count += 1
    fitimiByDate.set(key, entry)
  }

  const fitimiRows: (string | number)[][] = [
    ['Data', 'Nr. Shitjeve', 'Shitjet (L)', 'Fitimi (L)', 'Marzhi %'],
    ...Array.from(fitimiByDate.entries()).map(([dateKey, v]) => [
      dateKey,
      v.count,
      v.shitjet,
      v.fitimi,
      v.shitjet > 0 ? parseFloat(((v.fitimi / v.shitjet) * 100).toFixed(1)) : 0,
    ]),
    ['TOTAL', data.summary.numriShitjeve, data.summary.totali, data.summary.fitimi,
      data.summary.totali > 0 ? parseFloat(data.summary.marzhi.toFixed(1)) : 0],
  ]
  const wsFitimi = XLSX.utils.aoa_to_sheet(fitimiRows)
  wsFitimi['!cols'] = [
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, wsFitimi, 'Fitimi')

  // ── Download ─────────────────────────────────────────────
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  const filename = 'raport-' + safeFilename(data.periudhaLabel) + '-' + date + '.xlsx'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as any
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  triggerDownload(blob, filename)
}
