"""Destination photos, looked up by place name.

Order of preference:

1. **Unsplash**, when UNSPLASH_ACCESS_KEY is set. The key stays here on the
   server; the browser only ever sees the resulting image URLs.
2. **Wikimedia Commons**, which needs no key. Every photo there carries a
   free licence, and the author and licence travel with the result so the
   UI can credit them as the licence requires.

Results are cached for a day per query. If every source fails the list is
empty and the frontend draws its gradient placeholder. A broken image is
never returned: only URLs the source itself reported are passed on.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List

import httpx

from . import config
from .ttlcache import TTLCache

log = logging.getLogger("northern_trails.photos")

_cache = TTLCache("photos", ttl_sec=24 * 3600)

#: Commons is the canonical API. en.wikipedia serves the same shared file
#: repository and answers from networks where commons.wikimedia.org is slow.
WIKIMEDIA_APIS = ("https://commons.wikimedia.org/w/api.php",
                  "https://en.wikipedia.org/w/api.php")

#: Titles that are almost never a scenic photo of the place.
_REJECT = re.compile(r"\b(map|diagram|painting|drawing|logo|flag|seal|stamp|poster|"
                     r"chart|plan|sketch|coin|ISS\d+|18\d\d|19[0-5]\d)\b", re.I)


def _clean_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


async def _unsplash(client: httpx.AsyncClient, query: str, count: int) -> List[dict]:
    resp = await client.get(
        "https://api.unsplash.com/search/photos",
        params={"query": query, "per_page": min(30, count * 2), "orientation": "landscape",
                "content_filter": "high"},
        headers={"Authorization": f"Client-ID {config.UNSPLASH_KEY}", "Accept-Version": "v1"},
    )
    resp.raise_for_status()
    out = []
    for r in resp.json().get("results", []):
        user = r.get("user") or {}
        urls = r.get("urls") or {}
        if not urls.get("regular"):
            continue
        out.append({
            "id": "unsplash-" + r["id"],
            "url": urls["regular"],
            "thumb": urls.get("small") or urls["regular"],
            "width": r.get("width"), "height": r.get("height"),
            "alt": r.get("alt_description") or query,
            "credit": user.get("name", "Unsplash"),
            # Unsplash's attribution guidelines ask for these UTM parameters.
            "credit_url": (user.get("links") or {}).get("html", "https://unsplash.com")
                          + "?utm_source=northern_trails&utm_medium=referral",
            "license": "Unsplash License",
            "source": "unsplash",
        })
    return out[:count]


async def _wikimedia(client: httpx.AsyncClient, query: str, count: int) -> List[dict]:
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search", "gsrsearch": f"{query} filetype:bitmap",
        "gsrnamespace": "6", "gsrlimit": "24",
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata",
        "iiextmetadatafilter": "Artist|LicenseShortName|ImageDescription",
        "iiurlwidth": "1280", "origin": "*",
    }
    last_exc: Exception | None = None
    for api in WIKIMEDIA_APIS:
        try:
            # A short timeout per host: if one is unreachable the next is
            # tried before the page has finished waiting for its photos.
            resp = await client.get(api, params=params, timeout=6)
            resp.raise_for_status()
            pages = (resp.json().get("query") or {}).get("pages") or []
            break
        except Exception as exc:  # try the next mirror
            last_exc = exc
    else:
        raise last_exc or RuntimeError("no Wikimedia API reachable")

    pages = sorted(pages, key=lambda p: p.get("index", 0))
    out = []
    for p in pages:
        info = (p.get("imageinfo") or [{}])[0]
        title = p.get("title", "")
        w, h = info.get("width") or 0, info.get("height") or 0
        if info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        # Cards and heroes are landscape; a portrait or a small scan would
        # be cropped to nothing or blown up to mush.
        if w < 1000 or h == 0 or w / h < 1.2 or _REJECT.search(title):
            continue
        thumb = info.get("thumburl") or info.get("url")
        if not thumb:
            continue
        meta = info.get("extmetadata") or {}
        out.append({
            "id": "wm-" + str(p.get("pageid") or title),
            "url": thumb,
            # Wikimedia only renders a fixed set of thumbnail widths; 960 is
            # one of them and is sharp on a card at 2x pixel density.
            "thumb": re.sub(r"/\d+px-", "/960px-", thumb, count=1),
            "width": info.get("thumbwidth") or w, "height": info.get("thumbheight") or h,
            "alt": _clean_html((meta.get("ImageDescription") or {}).get("value", ""))[:160]
                   or title.removeprefix("File:").rsplit(".", 1)[0],
            "credit": _clean_html((meta.get("Artist") or {}).get("value", "")) or "Wikimedia Commons",
            "credit_url": info.get("descriptionurl") or "https://commons.wikimedia.org",
            "license": (meta.get("LicenseShortName") or {}).get("value", ""),
            "source": "wikimedia",
        })
        if len(out) >= count:
            break
    return out


async def search(query: str, count: int = 6, *, client: httpx.AsyncClient | None = None
                 ) -> Dict[str, Any]:
    """Up to `count` landscape photos of `query`, with credits."""
    query = " ".join((query or "").split())[:80]
    count = max(1, min(count, 12))
    if not query:
        return {"query": query, "source": "none", "items": []}

    key = f"{query.lower()}|{count}"
    cached = _cache.get(key)
    if cached is not None:
        return cached
    if not config.LOOKUPS_ENABLED and client is None:
        return {"query": query, "source": "none", "items": []}

    own = client is None
    client = client or httpx.AsyncClient(
        timeout=12, headers={"User-Agent": config.SOURCE_USER_AGENT}, follow_redirects=True)
    items: List[dict] = []
    source = "none"
    try:
        if config.UNSPLASH_KEY:
            try:
                items = await _unsplash(client, query, count)
                source = "unsplash"
            except Exception as exc:
                log.warning("unsplash '%s' failed: %s", query, exc)
        if len(items) < count:
            try:
                more = await _wikimedia(client, query, count - len(items))
                if more:
                    items += more
                    source = "wikimedia" if source == "none" else source + "+wikimedia"
            except Exception as exc:
                log.warning("wikimedia '%s' failed: %s", query, exc)
    finally:
        if own:
            await client.aclose()

    result = {"query": query, "source": source, "items": items}
    if items:
        _cache.set(key, result)
    else:
        # Both failed: an older answer beats no answer.
        stale = _cache.get(key, allow_stale=True)
        if stale is not None:
            return stale
    return result
