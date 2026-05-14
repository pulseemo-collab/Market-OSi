import { RiLockLine } from 'react-icons/ri'

export default function AccessDenied() {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <RiLockLine className="text-red-500 text-2xl" />
        </div>
        <h2 className="text-xl font-semibold text-slate-800 mb-2">Akses i Mohuar</h2>
        <p className="text-slate-500">Nuk ke akses në këtë faqe</p>
      </div>
    </div>
  )
}
