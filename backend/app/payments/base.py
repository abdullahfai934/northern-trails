"""Payment provider contract.

A provider turns a booking into a redirect the browser can POST to, and
later turns the gateway's callback back into a verdict. Nothing above this
layer knows which gateway is in use, so swapping JazzCash for Easypaisa is
a config change.

`Checkout.fields` is posted as a normal HTML form because both Pakistani
gateways use hosted-checkout redirects rather than a JSON API.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


def txn_ref(prefix: str = "NT") -> str:
    """A transaction reference unique per attempt, not per booking."""
    stamp = datetime.now(timezone.utc).strftime("%y%m%d%H%M%S")
    return f"{prefix}{stamp}{uuid.uuid4().hex[:4].upper()}"


@dataclass
class Checkout:
    """Everything the browser needs to hand the customer to the gateway."""
    provider: str
    txn_ref: str
    amount_pkr: int
    post_url: str
    fields: dict[str, str] = field(default_factory=dict)
    method: str = "POST"
    note: str = ""

    def as_dict(self) -> dict:
        return {
            "provider": self.provider, "txn_ref": self.txn_ref,
            "amount_pkr": self.amount_pkr, "post_url": self.post_url,
            "fields": self.fields, "method": self.method, "note": self.note,
        }


@dataclass
class Verdict:
    """The gateway's answer, after we have checked it is really theirs."""
    txn_ref: str
    paid: bool
    code: str = ""
    message: str = ""
    provider_ref: str = ""
    verified: bool = False          # did the signature/hash check out?
    raw: dict = field(default_factory=dict)

    @property
    def status(self) -> str:
        return "paid" if self.paid else "failed"


class PaymentProvider:
    name = "base"

    def configured(self) -> bool:
        raise NotImplementedError

    def start(self, *, txn: str, amount_pkr: int, booking_id: str,
              description: str, return_url: str,
              email: str = "", phone: str = "") -> Checkout:
        raise NotImplementedError

    def verify(self, payload: dict) -> Verdict:
        raise NotImplementedError

    @staticmethod
    def _expiry(hours: int = 1) -> datetime:
        return datetime.now(timezone.utc) + timedelta(hours=hours)
