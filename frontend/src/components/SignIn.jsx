import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarCheck, ChevronDown, Heart, KeyRound, LayoutDashboard, Loader2, LogOut, Mail, Phone,
  ShieldCheck, User,
} from 'lucide-react'

import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useT } from '../lib/i18n'
import { Field, Sheet, ease, fieldClass, useToast } from './ui'

/** Pakistani mobile numbers, normalised to the E.164 form Firebase needs. */
export function toE164(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('00')) return '+' + digits.slice(2)
  if (digits.startsWith('92')) return '+' + digits
  if (digits.startsWith('0')) return '+92' + digits.slice(1)   // 0300… -> +92300…
  if (digits.length === 10) return '+92' + digits              // 300… -> +92300…
  return '+' + digits
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

/** Firebase error codes, in words a traveler can act on. */
export function friendly(err) {
  const code = err?.code || ''
  const map = {
    'auth/invalid-email': 'That email address does not look right.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Use a password of at least 8 characters.',
    'auth/email-already-in-use': 'An account already uses this email. Sign in instead, or reset the password.',
    'auth/user-not-found': 'No account uses this email. Create one below.',
    'auth/wrong-password': 'Wrong password. Try again or reset it.',
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/user-disabled': 'This account has been disabled. Contact support.',
    'auth/popup-closed-by-user': 'The Google window was closed before signing in.',
    'auth/cancelled-popup-request': 'Another sign-in window is already open.',
    'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups and try again.',
    'auth/account-exists-with-different-credential': 'This email is registered with another sign-in method. Use that instead.',
    'auth/unauthorized-domain': 'Sign-in is not allowed from this web address.',
    'auth/operation-not-allowed': 'This sign-in method is not switched on yet. Use another method for now.',
    'auth/invalid-phone-number': 'That number does not look right. Try 0300 1234567.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/invalid-verification-code': 'That code is not correct. Check and re-enter it.',
    'auth/code-expired': 'That code expired. Request a new one.',
    'auth/quota-exceeded': 'Text-message sign-in has hit its daily limit. Use email or Google for now.',
    'auth/billing-not-enabled': 'Text-message codes are not available right now. Use email or Google.',
    'auth/invalid-app-credential': 'Verification failed. Reload the page and try again.',
    'auth/captcha-check-failed': 'Verification failed. Reload the page and try again.',
    'auth/network-request-failed': 'Network problem reaching the sign-in service. Check your connection.',
  }
  return map[code] || (err?.message || 'Something went wrong. Try again.').replace(/^Firebase: /, '')
}

function ErrorLine({ msg }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          role="alert" className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[12.5px] text-rose-300">
          {msg}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}

/* ---------------------------------------------------------------- email */
function EmailForm({ onDone }) {
  const auth = useAuth()
  const t = useT()
  const toast = useToast()
  const [mode, setMode] = useState('signin')       // signin | signup | reset
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const validate = () => {
    const e = {}
    if (mode === 'signup' && name.trim().length < 2) e.name = t('Enter your name')
    if (!EMAIL_RE.test(email.trim())) e.email = t('Enter a valid email address')
    if (mode !== 'reset' && password.length < (mode === 'signup' ? 8 : 1)) {
      e.password = mode === 'signup' ? t('At least 8 characters') : t('Enter your password')
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setError('')
    if (!validate()) return
    setBusy(true)
    try {
      if (mode === 'reset') {
        await auth.resetPassword(email.trim())
        toast(`Reset link sent to ${email.trim()}. Check your inbox.`)
        setMode('signin')
      } else if (mode === 'signup') {
        await auth.signUpEmail(name.trim(), email.trim(), password)
        try { auth.setProfile(await api.updateMe({ name: name.trim() })) } catch { /* profile catches up on next load */ }
        toast('Account created. We sent you a verification email.')
        onDone?.()
      } else {
        await auth.signInEmail(email.trim(), password)
        toast('Signed in')
        onDone?.()
      }
    } catch (e) {
      setError(friendly(e))
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      {mode === 'signup' && (
        <Field label={t('Full name')} htmlFor="si-name" error={errors.name}>
          <input id="si-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={fieldClass(errors.name)} />
        </Field>
      )}
      <Field label={t('Email')} htmlFor="si-email" error={errors.email}>
        <input id="si-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
               autoComplete="email" inputMode="email" className={fieldClass(errors.email)} placeholder="you@example.com" />
      </Field>
      {mode !== 'reset' && (
        <Field label={t('Password')} htmlFor="si-pass" error={errors.password}>
          <input id="si-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className={fieldClass(errors.password)} />
        </Field>
      )}
      <ErrorLine msg={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {mode === 'signin' ? t('Sign in') : mode === 'signup' ? t('Create account') : t('Send reset link')}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        {mode === 'signin' ? (
          <>
            <button type="button" onClick={() => { setMode('reset'); setError('') }} className="text-frost-400 hover:text-frost-100">
              {t('Forgot password?')}
            </button>
            <button type="button" onClick={() => { setMode('signup'); setError('') }} className="font-semibold text-glacier-300">
              {t('Create an account')}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { setMode('signin'); setError('') }} className="font-semibold text-glacier-300">
            ← {t('Back to sign in')}
          </button>
        )}
      </div>
    </form>
  )
}

/* ---------------------------------------------------------------- phone */
function PhoneForm({ onDone }) {
  const { sendOtp, confirmCode } = useAuth()
  const t = useT()
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef(null)
  useEffect(() => { if (confirmation) codeRef.current?.focus() }, [confirmation])

  const e164 = toE164(phone)
  const phoneValid = /^\+92\d{10}$/.test(e164) || /^\+\d{8,15}$/.test(e164)

  const send = async (ev) => {
    ev.preventDefault()
    if (!phoneValid) { setError(t('Enter a valid mobile number, e.g. 0300 1234567')); return }
    setBusy(true); setError('')
    try {
      setConfirmation(await sendOtp(e164, 'recaptcha-container'))
      toast(`Code sent to ${e164}`)
    } catch (e) { setError(friendly(e)) } finally { setBusy(false) }
  }
  const confirm = async (ev) => {
    ev.preventDefault()
    if (code.length < 6) { setError(t('Enter the 6-digit code')); return }
    setBusy(true); setError('')
    try {
      await confirmCode(confirmation, code)
      toast('Signed in')
      onDone?.()
    } catch (e) { setError(friendly(e)) } finally { setBusy(false) }
  }

  return !confirmation ? (
    <form onSubmit={send} noValidate className="space-y-3.5">
      <Field label={t('Mobile number')} htmlFor="si-phone" hint={phone ? `sends to ${e164}` : t('We text you a 6-digit code')}>
        <input id="si-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
               className="field" placeholder="0300 1234567" autoComplete="tel" />
      </Field>
      <ErrorLine msg={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Send code')}
      </button>
    </form>
  ) : (
    <form onSubmit={confirm} noValidate className="space-y-3.5">
      <p className="text-[13px] text-frost-300">{t('Enter the 6-digit code sent to')} <span className="font-mono text-frost-100">{e164}</span>.</p>
      <input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
             inputMode="numeric" autoComplete="one-time-code" aria-label="Verification code" placeholder="······"
             className="field text-center font-mono text-2xl tracking-[0.5em]" />
      <ErrorLine msg={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t('Verify and sign in')}
      </button>
      <button type="button" onClick={() => { setConfirmation(null); setCode(''); setError('') }}
              className="w-full text-[12px] text-frost-400 hover:text-frost-100">{t('Use a different number')}</button>
    </form>
  )
}

/* ---------------------------------------------------------------- sheet */
export function SignInSheet() {
  const auth = useAuth()
  const t = useT()
  const toast = useToast()
  const [tab, setTab] = useState('email')
  const [gBusy, setGBusy] = useState(false)
  const [gError, setGError] = useState('')
  const { open, reason } = auth.sheet
  useEffect(() => { if (!open) { setGError(''); setGBusy(false) } }, [open])

  const done = () => auth.closeSignIn()
  const google = async () => {
    setGBusy(true); setGError('')
    try {
      await auth.signInGoogle()
      toast('Signed in')
    } catch (e) { setGError(friendly(e)) } finally { setGBusy(false) }
  }

  return (
    <Sheet open={open} onClose={auth.closeSignIn} title={t('Sign in to Northern Trails')}>
      <div className="space-y-5">
        {reason && (
          <div className="flex items-center gap-2 rounded-xl border border-glacier-400/20 bg-glacier-400/[.07] px-3 py-2.5 text-[12.5px] text-glacier-200">
            <ShieldCheck className="h-4 w-4 shrink-0" /> {t(reason)}
          </div>
        )}
        <button onClick={google} disabled={gBusy} className="btn-ghost w-full !bg-white/[.06] hover:!bg-white/[.1]">
          {gBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />} {t('Continue with Google')}
        </button>
        <ErrorLine msg={gError} />
        <div className="flex items-center gap-3 text-[11px] uppercase tracking-[.16em] text-frost-400">
          <span className="hairline flex-1" /> {t('or')} <span className="hairline flex-1" />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[.06] bg-white/[.02] p-1" role="tablist">
          {[['email', Mail, t('Email')], ['phone', Phone, t('Phone')]].map(([id, Icon, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`relative flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-semibold transition
                ${tab === id ? 'text-frost-50' : 'text-frost-400 hover:text-frost-200'}`}>
              {tab === id && <motion.span layoutId="signin-tab" className="absolute inset-0 rounded-lg bg-white/[.07]" transition={{ duration: 0.35, ease }} />}
              <span className="relative flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" /> {label}</span>
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.3, ease }}>
            {tab === 'email' ? <EmailForm onDone={done} /> : <PhoneForm onDone={done} />}
          </motion.div>
        </AnimatePresence>
        <p className="text-center text-[11px] leading-relaxed text-frost-400">
          {t('Your account keeps your bookings, wishlist, trip plans and alerts in one place.')}
        </p>
      </div>
      {/* Firebase mounts its invisible reCAPTCHA here. */}
      <div id="recaptcha-container" />
    </Sheet>
  )
}

/* ------------------------------------------------------------- avatar */
export function Avatar({ name, photo, size = 'h-8 w-8' }) {
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return photo ? (
    <img src={photo} alt="" referrerPolicy="no-referrer" className={`${size} rounded-full object-cover ring-1 ring-white/10`} />
  ) : (
    <span className={`${size} grid place-items-center rounded-full bg-gradient-to-br from-glacier-400 to-amberz-400 text-[11px] font-bold text-abyss`}>{initials}</span>
  )
}

/** Header control: "Sign in", or the signed-in user's avatar and menu. */
export function AuthButton() {
  const auth = useAuth()
  const t = useT()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (!auth.configured) return null
  if (!auth.ready) return <span className="h-9 w-9 animate-pulse rounded-full bg-white/[.06]" aria-hidden="true" />

  if (!auth.signedIn) {
    return (
      <button onClick={() => auth.openSignIn()} aria-label={t('Sign in')}
        className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/10 bg-white/[.04] px-2.5 text-xs font-semibold text-frost-200 transition hover:border-glacier-400/40 hover:text-frost-50 sm:px-3">
        <User className="h-3.5 w-3.5" /><span className="hidden sm:inline">{t('Sign in')}</span>
      </button>
    )
  }

  const items = [
    ['/profile', User, t('My profile')],
    ['/profile?tab=bookings', CalendarCheck, t('My bookings')],
    ['/wishlist', Heart, t('Wishlist')],
    ...(auth.isOperator ? [['/operator', KeyRound, t('Operator console')]] : []),
    ...(auth.isOperator ? [['/admin', LayoutDashboard, auth.isAdmin ? t('Admin dashboard') : t('Manage packages')]] : []),
  ]
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={t('Account menu')}
        className="flex items-center gap-1.5 rounded-full border border-white/10 p-0.5 pr-2 transition hover:border-glacier-400/40">
        <Avatar name={auth.displayName} photo={auth.photoURL} />
        <ChevronDown className={`h-3.5 w-3.5 text-frost-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease }}
            className="glass-strong absolute end-0 top-11 z-[90] w-60 overflow-hidden rounded-2xl p-1.5">
            <div className="flex items-center gap-3 border-b border-white/[.06] px-3 pb-3 pt-2">
              <Avatar name={auth.displayName} photo={auth.photoURL} size="h-9 w-9" />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-frost-50">{auth.displayName}</div>
                <div className="text-[10px] font-bold uppercase tracking-[.14em] text-glacier-300">{t(auth.role)}</div>
              </div>
            </div>
            {items.map(([to, Icon, label]) => (
              <Link key={to} to={to} role="menuitem" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-frost-200 transition hover:bg-white/[.06] hover:text-frost-50">
                <Icon className="h-4 w-4 text-frost-400" /> {label}
              </Link>
            ))}
            <button role="menuitem" onClick={async () => { setOpen(false); await auth.signOut(); navigate('/') }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-lg border-t border-white/[.06] px-3 py-2 text-[13px] text-frost-300 transition hover:bg-rose-400/10 hover:text-rose-300">
              <LogOut className="h-4 w-4" /> {t('Sign out')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
