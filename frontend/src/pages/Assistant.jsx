import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Send, MessagesSquare, ShieldCheck, Database, RotateCcw, AlertCircle } from 'lucide-react'

import { useData } from '../lib/store'
import { api } from '../lib/api'
import { Reveal, ease } from '../components/ui'
import { useStreamedText } from '../components/motion'

const KIND_TONE = {
  road: 'text-glacier-300 bg-glacier-400/10 ring-glacier-400/25',
  alert: 'text-rose-300 bg-rose-400/10 ring-rose-400/25',
  weather: 'text-sky-300 bg-sky-400/10 ring-sky-400/25',
  package: 'text-amberz-300 bg-amberz-400/10 ring-amberz-400/25',
  operator: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/25',
  destination: 'text-glacier-300 bg-glacier-400/10 ring-glacier-400/25',
  restaurant: 'text-orange-300 bg-orange-400/10 ring-orange-400/25',
}

const GREETING = {
  id: 'greeting',
  role: 'assistant',
  content:
    "I'm the live-conditions assistant. I answer from the current road-status feed, weather, recent earthquakes and hazards, the package catalogue and restaurants near each destination, and I'll tell you when I don't have a record rather than guess.\n\nAsk me about a route, a closure, a trip within your budget, or where to eat.",
  citations: [],
}

const STORE = 'nt-chat:v1'
const MAX_KEPT = 40

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '[]')
    return Array.isArray(saved) && saved.length ? saved : [GREETING]
  } catch { return [GREETING] }
}

const newId = () => Math.random().toString(36).slice(2, 10)

export default function Assistant() {
  const d = useData()
  const [messages, setMessages] = useState(loadHistory)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy])

  // Chat history survives reloads and navigation; errors are not kept.
  useEffect(() => {
    try {
      const keep = messages.filter((m) => !m.error).slice(-MAX_KEPT).map(({ fresh, ...m }) => m)
      localStorage.setItem(STORE, JSON.stringify(keep))
    } catch { /* storage full or blocked: history just is not kept */ }
  }, [messages])

  const ask = async (q, base) => {
    const history = base
      .filter((m) => m.id !== 'greeting' && !m.error)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }))
    setBusy(true)
    try {
      const r = await api.chat(q, history)
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: r.answer, citations: r.citations, engine: r.engine, fresh: true }])
    } catch (e) {
      setMessages((m) => [...m, { id: newId(), role: 'assistant', error: true, retry: q, content: e.message }])
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const send = (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    if (q.length > 1000) return
    setInput('')
    const next = [...messages, { id: newId(), role: 'user', content: q }]
    setMessages(next)
    ask(q, messages)
  }

  const retry = (msg) => {
    const base = messages.filter((m) => m.id !== msg.id)
    setMessages(base)
    ask(msg.retry, base.slice(0, -1))
  }

  const reset = () => {
    setMessages([GREETING])
    try { localStorage.removeItem(STORE) } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-4xl px-5 pb-16 pt-14 sm:px-8">
      <Reveal>
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="mb-3 flex items-center gap-2.5">
              <span className="h-px w-8 bg-gradient-to-r from-glacier-400 to-transparent" />
              <span className="text-[11px] font-bold uppercase tracking-[.22em] text-glacier-300">Grounded assistant</span>
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-frost-50 sm:text-[2.4rem]">
              Ask about the North.
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-frost-300">
              Before every answer, the matching road, weather, hazard, package and restaurant records
              are sent to the model with your question, and it may only answer from those.
            </p>
          </div>
          {messages.length > 1 && (
            <button onClick={reset} className="btn-ghost shrink-0 !py-2 !text-[12px]">
              <RotateCcw className="h-3.5 w-3.5" /> New chat
            </button>
          )}
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <div className="glass flex min-h-[60vh] flex-col rounded-2xl">
          {/* transcript */}
          <div className="max-h-[65vh] flex-1 space-y-5 overflow-y-auto p-5 no-scrollbar" aria-live="polite">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.div key={m.id}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.45, ease }}
                  className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[88%] ${m.role === 'user' ? '' : 'w-full'}`}>
                    {m.role === 'assistant' && (
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-glacier-400 to-amberz-400 text-abyss">
                          <MessagesSquare className="h-3 w-3" />
                        </span>
                        <span className="text-[11px] font-bold text-frost-300">Northern Trails</span>
                        {m.engine && (
                          <span className="chip !py-0.5 !text-[9px] uppercase tracking-wider">
                            {m.engine === 'gemini' ? 'gemini · grounded' : 'grounded retrieval'}
                          </span>
                        )}
                      </div>
                    )}
                    {m.error ? (
                      <div className="flex items-start gap-3 rounded-2xl rounded-bl-sm border border-rose-400/20 bg-rose-400/[.06] px-4 py-3 text-[13px] text-frost-200" role="alert">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-rose-200">I couldn't get an answer just now.</div>
                          <div className="mt-0.5 text-[12px] text-frost-400">{m.content}</div>
                          <button onClick={() => retry(m)} disabled={busy} className="btn-ghost mt-2.5 !px-3 !py-1.5 !text-[12px]">
                            <RotateCcw className="h-3 w-3" /> Try again
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={
                        m.role === 'user'
                          ? 'rounded-2xl rounded-br-sm bg-glacier-400/15 px-4 py-2.5 text-[13.5px] leading-relaxed text-frost-50 ring-1 ring-glacier-400/20'
                          : 'rounded-2xl rounded-bl-sm bg-white/[.04] px-4 py-3.5 text-[13.5px] leading-relaxed text-frost-200'
                      }>
                        {m.role === 'assistant'
                          ? <StreamedAnswer m={m} onGrow={() => endRef.current?.scrollIntoView({ block: 'end' })} />
                          : <Markdownish text={m.content} />}

                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            <AnimatePresence>
              {busy && (
                <motion.div key="typing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-3" aria-label="Assistant is typing">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-glacier-400 to-amberz-400 text-abyss">
                    <MessagesSquare className="h-3 w-3" />
                  </span>
                  <span className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-white/[.05] px-4 py-3">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-1.5 w-1.5 animate-typing rounded-full bg-glacier-300"
                            style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </span>
                  <span className="text-[11px] text-frost-400">checking live records…</span>
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={endRef} />
          </div>

          {/* suggestions */}
          {messages.length === 1 && d?.suggestions && (
            <div className="flex flex-wrap gap-1.5 border-t border-white/[.07] px-5 py-3">
              {d.suggestions.map((s, i) => (
                <motion.button key={s} onClick={() => send(s)}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.4, ease }}
                  className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5 text-[11.5px] text-frost-300 transition hover:border-glacier-400/40 hover:bg-glacier-400/10 hover:text-glacier-200">
                  {s}
                </motion.button>
              ))}
            </div>
          )}

          {/* composer */}
          <form className="border-t border-white/[.07] p-4" onSubmit={(e) => { e.preventDefault(); send() }}>
            <div className="flex items-end gap-2">
              <label htmlFor="chat-input" className="sr-only">Your question</label>
              <textarea
                id="chat-input"
                ref={inputRef}
                value={input}
                maxLength={1000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                placeholder="Is the Skardu road open? Where can I eat in Karimabad?"
                className="field max-h-32 flex-1 resize-none !py-3"
              />
              <button type="submit" disabled={busy || !input.trim()} className="btn-primary !px-4 !py-3" aria-label="Send">
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-frost-400">
              Safety-critical answers are only as fresh as the feed behind them, so always confirm a closure with the operator before you set off.
            </p>
          </form>
        </div>
      </Reveal>
    </div>
  )
}

/** Minimal markdown: **bold**, *italic*, bullet lists and paragraph breaks. */
/**
 * A new answer streams in word by word, then its citations fade in. Screen
 * readers get the whole answer at once (the moving copy is hidden from them);
 * old messages and reduced motion show it complete.
 */
function StreamedAnswer({ m, onGrow }) {
  const reduce = useReducedMotion()
  const streaming = Boolean(m.fresh) && !reduce
  const { text, done } = useStreamedText(m.content, streaming)
  useEffect(() => { if (streaming) onGrow?.() }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {streaming && !done && <span className="sr-only">{m.content}</span>}
      <div aria-hidden={streaming && !done ? 'true' : undefined}>
        <Markdownish text={text} />
      </div>
      {done && m.citations?.length > 0 && (
        <motion.div initial={streaming ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
          <Citations items={m.citations} />
        </motion.div>
      )}
    </>
  )
}

function Citations({ items }) {
  return (
    <div className="mt-4 border-t border-white/[.07] pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-frost-400">
        <Database className="h-3 w-3" /> grounded in {items.length} live record{items.length > 1 ? 's' : ''}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <span key={c.id} title={`${c.label || c.id}, ${c.source}${c.updated_at ? ' · ' + c.updated_at : ''}`}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] ring-1 ${KIND_TONE[c.kind] || KIND_TONE.road}`}>
            <ShieldCheck className="h-3 w-3" />{c.kind === 'restaurant' ? c.label : c.id}
          </span>
        ))}
      </div>
    </div>
  )
}

function inline(text, key) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g).map((chunk, j) => {
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <strong key={`${key}-${j}`} className="font-bold text-frost-50">{chunk.slice(2, -2)}</strong>
    }
    if (chunk.length > 2 && chunk.startsWith('*') && chunk.endsWith('*')) {
      return <em key={`${key}-${j}`}>{chunk.slice(1, -1)}</em>
    }
    return <span key={`${key}-${j}`}>{chunk}</span>
  })
}

function Markdownish({ text }) {
  const blocks = String(text || '').split(/\n{2,}/)
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n')
        const bullet = /^\s*(?:[-*·•]|\d+\.)\s+/
        const items = lines.filter((l) => bullet.test(l))
        const lead = lines.filter((l) => !bullet.test(l) && l.trim())
        return (
          <div key={i} className={i ? 'mt-3' : ''}>
            {lead.map((l, k) => <p key={k} className={k ? 'mt-1' : ''}>{inline(l, `${i}-${k}`)}</p>)}
            {items.length > 0 && (
              <ul className={`space-y-1.5 ${lead.length ? 'mt-2' : ''}`}>
                {items.map((l, k) => (
                  <li key={k} className="flex gap-2">
                    <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-glacier-300" />
                    <span>{inline(l.replace(bullet, ''), `${i}-li-${k}`)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </>
  )
}
