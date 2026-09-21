"""Payment provider contract.

A provider turns a booking into a redirect the browser can POST to, and
later turns the gateway's callback back into a verdict. Nothing above this
layer knows which gateway is in use, so swapping JazzCash for Easypaisa is
a config change.

`Checkout.fields` is posted as a normal HTML form because both Pakistani
gateways use hosted-checkout redirects rather than a JSON API.
"""
from __future__ import annotations

import itertools
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


#: JazzCash caps pp_TxnRefNo at 20 characters, so the whole reference must
#: fit that budget. Base36 buys the room a decimal timestamp wastes:
#: 2 prefix + 6 epoch + 4 sequence + 8 random = 20.
_TXN_MAX = 20
_counter = itertools.count(random.randrange(36 ** 4))


def _b36(n: int, width: int) -> str:
    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    out = ""
    for _ in range(width):
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def txn_ref(prefix: str = "NT") -> str:
    """A transaction reference unique per attempt, not per booking.

    Randomness alone is not enough. Four hex characters gave 65,536 values
    inside one second, which collides by the birthday bound after a few
    hundred references — and this is the primary key of the payments
    table, so a collision would cross two real transactions.

    The sequence counter is what actually guarantees uniqueness: 36^4 is
    1.68 million values, far beyond what one process issues in a second,
    so it cannot wrap and repeat. The random tail then keeps references
    unguessable and safe across multiple workers, and the base36 epoch
    keeps the whole thing inside JazzCash's 20-character limit.
    """
    epoch = _b36(int(datetime.now(timezone.utc).timestamp()), 6)
    seq = _b36(next(_counter), 4)
    tail = _b36(random.getrandbits(41), 8)
    ref = f"{prefix}{epoch}{seq}{tail}"
    assert len(ref) <= _TXN_MAX, ref
    return ref


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
