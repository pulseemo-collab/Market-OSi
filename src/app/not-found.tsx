import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
      <p className="text-6xl font-bold text-slate-200 mb-4">404</p>
      <h1 className="text-xl font-semibold text-slate-700 mb-2">Faqja nuk u gjet</h1>
      <p className="text-slate-400 mb-6">Faqja që kërkoni nuk ekziston.</p>
      <Link href="/" className="btn-primary">
        Kthehu në Panelin Kryesor
      </Link>
    </div>
  )
}
