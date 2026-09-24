/**
 * English / Urdu.
 *
 * i18next with the English sentence as the key: `t('Book now')`. A string
 * with no Urdu entry falls back to its English text, so nothing ever renders
 * as a raw key. Switching to Urdu also sets <html dir="rtl" lang="ur">, and
 * the layout uses logical properties (start/end) so it mirrors correctly.
 */
import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import ur from './locales/ur.json'

const KEY = 'nt-lang'

function initial() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'ur' || saved === 'en') return saved
  } catch { /* storage blocked */ }
  return 'en'
}

export function applyDirection(lng) {
  const html = document.documentElement
  html.setAttribute('lang', lng)
  html.setAttribute('dir', lng === 'ur' ? 'rtl' : 'ltr')
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: {} }, ur: { translation: ur } },
  lng: initial(),
  fallbackLng: 'en',
  keySeparator: false,          // keys are sentences, which contain dots
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
})
applyDirection(i18n.language)

export function setLanguage(lng) {
  i18n.changeLanguage(lng)
  applyDirection(lng)
  try { localStorage.setItem(KEY, lng) } catch { /* ignore */ }
}

/** `const t = useT()` — the translate function, re-rendering on change. */
export function useT() {
  return useTranslation().t
}

export function useLanguage() {
  const { i18n: inst } = useTranslation()
  return { lang: inst.language, setLanguage, isUrdu: inst.language === 'ur' }
}

export default i18n
