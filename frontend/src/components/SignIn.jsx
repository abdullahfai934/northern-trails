import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LogOut, Phone, ShieldCheck } from 'lucide-react'

import { useAuth } from '../lib/auth'
import { Sheet, useToast } from './ui'

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

export function SignInSheet({ open, onClose }) {
  const { sendOtp, confirmCode, configured } = useAuth()
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const codeRef = useRef(null)

  useEffect(() => {
    if (!open) { setConfirmation(null); setCode(''); setError(''); setBusy(false) }
  }, [open])

  useEffect(() => { if (confirmation) codeRef.current?.focus() }, [confirmation])

  const e164 = toE164(phone)
  const phoneValid = /^\+92\d{10}$/.test(e164) || /^\+\d{8,15}$/.test(e164)

  async function handleSend(event) {
    event.preventDefault()
    if (!phoneValid) { setError('Enter a valid mobile number, e.g. 0300 1234567'); return }
    setBusy(true); setError('')
    try {
      setConfirmation(await sendOtp(e164, 'recaptcha-container'))
      toast?.(`Code sent to ${e164}`)
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirm(event) {
    event.preventDefault()
    if (code.trim().length < 6) { setError('Enter the 6-digit code'); return }
    setBusy(true); setError('')
    try {
      await confirmCode(confirmation, code.trim())
      toast?.('Signed in')
      onClose?.()
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Sign in">
      {!configured ? (
        <div className="space-y-3 text-sm text-frost-300">
          <p className="text-frost-100">Phone sign-in is not configured on this build.</p>
          <p>
            Add your Firebase web config to <code className="font-mono text-glacier-300">.env</code>{' '}
            (<code className="font-mono text-xs">VITE_FIREBASE_*</code>) and enable Phone
            authentication in the Firebase console. Everything else works signed out.
          </p>
        </div>
      ) : !confirmation ? (
        <form onSubmit={handleSend} className="space-y-4">
          <p className="text-sm text-frost-300">
            We send a one-time code by SMS. Your number identifies your bookings and the
            routes you follow.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs uppercase tracking-wide text-frost-400">
              Mobile number
            </span>
            <div className="flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-850 px-3">
              <Phone className="h-4 w-4 shrink-0 text-frost-400" />
              <input
                autoFocus
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0300 1234567"
                className="w-full bg-transparent py-3 text-frost-50 outline-none placeholder:text-frost-400/60"
              />
            </div>
            {phone && (
              <span className="mt-1.5 block font-mono text-xs text-frost-400">
                sends to {e164}
              </span>
            )}
          </label>
          {error && <Error msg={error} />}
          <button
            type="submit"
            disabled={busy || !phoneValid}
            className="w-full rounded-xl bg-glacier-400 py-3 font-semibold text-ink-950 transition disabled:opacity-40"
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleConfirm} className="space-y-4">
          <p className="text-sm text-frost-300">
            Enter the 6-digit code sent to{' '}
            <span className="font-mono text-frost-100">{e164}</span>.
          </p>
          <input
            ref={codeRef}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="······"
            className="w-full rounded-xl border border-ink-700 bg-ink-850 py-3 text-center font-mono text-2xl tracking-[0.5em] text-frost-50 outline-none focus:border-glacier-500"
          />
          {error && <Error msg={error} />}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="w-full rounded-xl bg-glacier-400 py-3 font-semibold text-ink-950 transition disabled:opacity-40"
          >
            {busy ? 'Verifying…' : 'Verify & sign in'}
          </button>
          <button
            type="button"
            onClick={() => { setConfirmation(null); setCode(''); setError('') }}
            className="w-full text-xs text-frost-400 underline-offset-4 hover:underline"
          >
            Use a different number
          </button>
        </form>
      )}
      {/* Firebase mounts its invisible reCAPTCHA here. */}
      <div id="recaptcha-container" />
    </Sheet>
  )
}

function Error({ msg }) {
  return (
    <motion.p
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
    >
      {msg}
    </motion.p>
  )
}

/** Firebase error codes are not user-facing English. */
function friendly(err) {
  const code = err?.code || ''
  const map = {
    'auth/invalid-phone-number': 'That number does not look right. Try 0300 1234567.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/invalid-verification-code': 'That code is not correct. Check and re-enter it.',
    'auth/code-expired': 'That code expired. Request a new one.',
    'auth/quota-exceeded': 'The daily SMS quota for this project is used up.',
    'auth/operation-not-allowed': 'Phone sign-in is not enabled in the Firebase console.',
    'auth/captcha-check-failed': 'Verification failed. Reload the page and try again.',
  }
  return map[code] || err?.message || 'Something went wrong. Try again.'
}

/** Header control: opens the sheet, or shows who is signed in. */
export function AuthButton() {
  const { configured, signedIn, phone, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  if (!configured) return null

  return (
    <>
      {signedIn ? (
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-glacier-500/30 bg-glacier-500/10 px-3 py-1.5 text-xs text-glacier-300 sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="font-mono">{phone}</span>
          </span>
          <button
            onClick={signOut}
            title="Sign out"
            className="rounded-full border border-ink-700 p-2 text-frost-300 transition hover:text-frost-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-850 px-3 py-1.5 text-xs font-medium text-frost-200 transition hover:border-glacier-500/40 hover:text-frost-50"
        >
          <Phone className="h-3.5 w-3.5" />
          Sign in
        </button>
      )}
      <SignInSheet open={open} onClose={() => setOpen(false)} />
    </>
  )
}
