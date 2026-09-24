import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Lock, ShieldAlert } from 'lucide-react'

import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { Skeleton, ease } from './ui'

/**
 * Wraps a page that needs an account (and optionally a role).
 *
 *   <Guard>…</Guard>                  signed in
 *   <Guard role="operator">…</Guard>  operator or admin
 *   <Guard role="admin">…</Guard>     admin only
 *
 * The server enforces the same rules on every API call; this only decides
 * what to draw, so a signed-out visitor sees a way in rather than errors.
 */
export default function Guard({ role, children, reason }) {
  const auth = useAuth()
  const t = useT()

  if (!auth.ready || (auth.signedIn && !auth.profile && !auth.profileError)) {
    return (
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-14 sm:px-8">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      </div>
    )
  }

  const allowed = role === 'admin' ? auth.isAdmin : role === 'operator' ? auth.isOperator : true

  if (!auth.signedIn || !allowed) {
    const signedOut = !auth.signedIn
    return (
      <div className="mx-auto max-w-lg px-5 pb-16 pt-24 text-center">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}
          className="glass rounded-3xl p-9">
          <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-glacier-400/10 text-glacier-300">
            {signedOut ? <Lock className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </span>
          <h1 className="text-xl font-semibold text-frost-50">
            {signedOut ? t('Please sign in') : role === 'admin' ? t('Admins only') : t('For operators')}
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-frost-300">
            {signedOut
              ? t(reason || 'Sign in to see this page.')
              : role === 'admin'
                ? t('This dashboard is for Northern Trails administrators.')
                : t('This console is for verified tour operators. If you run one, ask an admin to link your account.')}
          </p>
          {signedOut ? (
            <button onClick={() => auth.openSignIn(reason)} className="btn-primary mt-6">{t('Sign in')}</button>
          ) : (
            <Link to="/" className="btn-ghost mt-6">{t('Back to home')}</Link>
          )}
        </motion.div>
      </div>
    )
  }
  return children
}
