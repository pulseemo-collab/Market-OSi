import { RiLockLine, RiPhoneLine } from 'react-icons/ri'

export default function SubscriptionExpired() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="text-center max-w-sm mx-auto">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <RiLockLine className="text-3xl text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Abonimi ka skaduar</h1>
        <p className="text-sm text-slate-500 leading-relaxed mb-6">
          Kontaktoni platformën për të rinovuar aksesin tuaj.
        </p>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <RiPhoneLine className="text-base" />
          <span>Kontaktoni administratorin e platformës</span>
        </div>
      </div>
    </div>
  )
}
