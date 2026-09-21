"""Provider registry.

`get_provider()` honours an explicit choice when that provider has
credentials, and otherwise falls back to the mock gateway so checkout is
always demonstrable.
"""
from __future__ import annotations

from ..config import PAYMENTS_PROVIDER
from .base import Checkout, PaymentProvider, Verdict, txn_ref
from .easypaisa import EasypaisaProvider
from .jazzcash import JazzCashProvider
from .mock import MockProvider

PROVIDERS: dict[str, PaymentProvider] = {
    "jazzcash": JazzCashProvider(),
    "easypaisa": EasypaisaProvider(),
    "mock": MockProvider(),
}


def get_provider(name: str = "") -> PaymentProvider:
    chosen = (name or PAYMENTS_PROVIDER or "mock").lower()
    provider = PROVIDERS.get(chosen)
    if provider is None or not provider.configured():
        return PROVIDERS["mock"]
    return provider


def available() -> list[dict]:
    return [{"id": key, "name": key.title(), "configured": p.configured()}
            for key, p in PROVIDERS.items()]


__all__ = ["Checkout", "PaymentProvider", "Verdict", "txn_ref",
           "get_provider", "available", "PROVIDERS"]
