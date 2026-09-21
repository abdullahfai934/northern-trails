import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Send, Sparkles, ShieldCheck, Database, Loader2, RotateCcw } from 'lucide-react'

import { useData } from '../lib/store'
import { api } from '../lib/api'
import { Reveal, ease } from '../components/ui'
import NeedsBackend from '../components/NeedsBackend'

const KIND_TONE = {
  road: 'text-glacier-300 bg-glacier-400/10 ring-glacier-400/25',
  alert: 'text-rose-300 bg-rose-400/10 ring-rose-400/25',
  weather: 'text-sky-300 bg-sky-400/10 ring-sky-400/25',
  package: 'text-amberz-300 bg-amberz-400/10 ring-amberz-400/25',
  operator: 'text-emerald-300 bg-emerald-400/10 ring-emerald-400/25',
}

const GREETING = {
  role: 'assistant',
  content:
    "I'm the live-conditions assistant. I answer from the current road-status feed, weather poller, permit records and verified operator listings — and I'll tell you when I don't have a record rather than guess.\n\nAsk me about a route, a closure, permits, or what to book.",
  citations: [],
}

export default function Assistant() {
  const d = useData()
  const [messages, setMessages] = useState([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const send = async (text) => {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    const history = messages.filter((m) => m !== GREETING).map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: q }])
    setBusy(true)
    try {
      const r = await api.chat(q, history)
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, citations: r.citations, engine: r.engine }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: 'I could not reach the live data layer: ' + e.message, citations: [] }])
    } finally { setBusy(false) }
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
            <h1 className="text-3xl font-extrabold tracking-tight text-frost-50 sm:text-[2.4rem]">
              Ask about the North.
            </h1>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-frost-300">
              Retrieval runs first: matching road, weather, permit, package and operator records are
              packed into the prompt, and the answer may only use that pack.
            </p>
          </div>
          {messages.length > 1 && (
            <button onClick={() => setMessages([GREETING])} className="btn-ghost shrink-0 !py-2 !text-[12px]">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      </Reveal>

      {d?.offline && (
        <Reveal delay={0.04}>
          <div className="mb-5">
            <NeedsBackend feature="The grounded assistant">
              <p className="mt-3 text-[12px] leading-relaxed text-frost-400">
                It answers only from live road, weather, permit and operator records and
                refuses anything outside them — so with no data layer to retrieve from,
                there is nothing it could honestly say.
              </p>
            </NeedsBackend>
          </div>
        </Reveal>
      )}

      <Reveal delay={0.05}>
        <div className={`glass flex min-h-[55vh] flex-col rounded-2xl transition-opacity duration-500 ${d?.offline ? 'pointer-events-none opacity-40' : ''}`}>
          {/* transcript */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5 no-scrollbar">
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.45, ease }}
                  className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[88%] ${m.role === 'user' ? '' : 'w-full'}`}>
                    {m.role === 'assistant' && (
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-glacier-400 to-amberz-400 text-ink-950">
                          <Sparkles className="h-3 w-3" />
                        </span>
                        <span className="text-[11px] font-bold text-frost-300">Northern Trails</span>
                        {m.engine && (
                          <span className="chip !py-0.5 !text-[9px] uppercase tracking-wider">
                            {m.engine === 'gemini' ? 'gemini · grounded' : 'grounded retrieval'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className={
                      m.role === 'user'
                        ? 'rounded-2xl rounded-br-sm bg-glacier-400/15 px-4 py-2.5 text-[13.5px] leading-relaxed text-frost-50 ring-1 ring-glacier-400/20'
                        : 'rounded-2xl rounded-bl-sm bg-white/[.04] px-4 py-3.5 text-[13.5px] leading-relaxed text-frost-200'
                    }>
                      <Markdownish text={m.content} />

                      {m.citations?.length > 0 && (
                        <div className="mt-4 border-t border-white/[.07] pt-3">
                          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-frost-400">
                            <Database className="h-3 w-3" /> grounded in {m.citations.length} live record{m.citations.length > 1 ? 's' : ''}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {m.citations.map((c) => (
                              <span key={c.id} title={`${c.source}${c.updated_at ? ' · ' + c.updated_at : ''}`}
                                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] ring-1 ${KIND_TONE[c.kind] || KIND_TONE.road}`}>
                                <ShieldCheck className="h-3 w-3" />{c.id}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {busy && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-[12px] text-frost-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-glacier-300" />
                retrieving live records…
              </motion.div>
            )}
            <div ref={endRef} />
          </div>

          {/* suggestions */}
          {messages.length === 1 && d.suggestions && (
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
          <div className="border-t border-white/[.07] p-4">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                rows={1}
                placeholder="Is the Skardu road open? What permits do I need for Khunjerab?"
                className="field max-h-32 flex-1 resize-none !py-3"
              />
              <button onClick={() => send()} disabled={busy || !input.trim()} className="btn-primary !px-4 !py-3">
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 text-[11px] text-frost-400">
              Safety-critical answers are only as fresh as the feed behind them — always confirm a closure with the operator before you set off.
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  )
}

/** Minimal markdown: **bold** and paragraph breaks — enough for the answer format. */
function Markdownish({ text }) {
  return (
    <>
      {text.split('\n\n').map((para, i) => (
        <p key={i} className={i ? 'mt-3' : ''}>
          {para.split(/(\*\*[^*]+\*\*)/g).map((chunk, j) =>
            chunk.startsWith('**') && chunk.endsWith('**')
              ? <strong key={j} className="font-bold text-frost-50">{chunk.slice(2, -2)}</strong>
              : <span key={j}>{chunk}</span>
          )}
        </p>
      ))}
    </>
  )
}
