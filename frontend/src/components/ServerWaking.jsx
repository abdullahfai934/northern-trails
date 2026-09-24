import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, WifiOff } from 'lucide-react'
import { onServerState } from '../lib/api'
import { useT } from '../lib/i18n'
import { ease } from './ui'

/**
 * A quiet banner while the API wakes from a cold start. Requests are held and
 * resent by lib/api, so pages keep their own loading skeletons and never see
 * an error for it; this only explains the wait.
 */
export function ServerWaking() {
  const t = useT()
  const [state, setState] = useState('ready')
  const [seconds, setSeconds] = useState(0)

  useEffect(() => onServerState(setState), [])
  useEffect(() => {
    if (state !== 'waking') { setSeconds(0); return undefined }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [state])

  const show = state === 'waking' && seconds >= 2 || state === 'down'
  return (
    <AnimatePresence>
      {show && (
        <motion.div role="status" aria-live="polite"
          initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }}
          transition={{ duration: 0.45, ease }}
          className="fixed inset-x-4 bottom-24 z-[90] mx-auto max-w-md rounded-2xl bg-ink-900/95 p-4 text-[13px] shadow-lift ring-1 ring-white/[.08] backdrop-blur-xl md:bottom-6">
          {state === 'down' ? (
            <div className="flex items-start gap-3">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amberz-400" />
              <div>
                <div className="font-semibold text-frost-50">{t('The server is not answering')}</div>
                <p className="mt-0.5 text-frost-300">{t('Please refresh the page in a minute.')}</p>
                <button onClick={() => window.location.reload()} className="mt-2 font-semibold text-glacier-300 hover:text-glacier-200">{t('Refresh')}</button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-glacier-300" />
              <div>
                <div className="font-semibold text-frost-50">{t('Waking up the server…')}</div>
                <p className="mt-0.5 text-frost-300">{t('It sleeps when nobody is using it. The first visit can take up to a minute; your page will load by itself.')}</p>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
