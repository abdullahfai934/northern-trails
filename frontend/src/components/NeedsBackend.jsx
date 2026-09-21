import React from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ServerCog, Terminal } from 'lucide-react'

/**
 * Shown on pages whose whole purpose is a live backend call.
 *
 * Without this they fail silently — the assistant returns a raw fetch
 * error, the operator console sits empty forever — and a reader cannot
 * tell a broken feature from an undeployed one. Naming the reason is the
 * difference.
 */
export default function NeedsBackend({ feature, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-amberz-400/20 bg-gradient-to-br from-amberz-400/[.08] via-white/[.02] to-transparent p-6 sm:p-8"
    >
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amberz-400/12 text-amberz-300">
          <ServerCog className="h-5 w-5" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h3 className="font-display text-lg text-frost-50">{feature} needs the live API</h3>
          <p className="mt-1.5 max-w-lg text-[13px] leading-relaxed text-frost-300">
            This page is served as static files, and the FastAPI backend that answers
            it is not deployed yet. Everything else on the site still works from a
            bundled snapshot.
          </p>

          <div className="mt-4 rounded-xl border border-white/[.07] bg-ink-950/60 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-frost-400">
              <Terminal className="h-3 w-3" /> run it locally
            </div>
            <code className="block font-mono text-[11.5px] leading-relaxed text-glacier-200">
              ./scripts/api.sh<br />./scripts/web.sh
            </code>
            <p className="mt-2 text-[11px] text-frost-400">
              then open <span className="font-mono text-frost-300">localhost:5173</span> — live
              weather, hazards, routing and matching all work there.
            </p>
          </div>

          {children}

          <div className="mt-4 flex flex-wrap gap-2.5">
            <Link to="/conditions" className="rounded-lg border border-white/10 px-3.5 py-2 text-[12px] text-frost-200 transition hover:bg-white/[.06]">
              Browse conditions
            </Link>
            <Link to="/explore" className="rounded-lg border border-white/10 px-3.5 py-2 text-[12px] text-frost-200 transition hover:bg-white/[.06]">
              Browse packages
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
