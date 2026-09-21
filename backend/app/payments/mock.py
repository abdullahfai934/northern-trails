"""Offline gateway used when no real credentials are present.

It behaves like the hosted checkouts — a redirect out, a signed callback
back — so the booking flow, the payments table and the return page are all
exercised for real. Only the bank is missing.

The callback is signed with an HMAC over the same fields, so the
verification path being tested is the genuine one, not a bypass.
"""
from __future__ import annotations

import hashlib
import hmac

from .base import Checkout, PaymentProvider, Verdict

SECRET = "northern-trails-mock-gateway"


def sign(fields: dict) -> str:
    message = "&".join(f"{k}={fields[k]}" for k in sorted(fields) if k != "signature")
    return hmac.new(SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()


class MockProvider(PaymentProvider):
    name = "mock"

    def configured(self) -> bool:
        return True

    def start(self, *, txn: str, amount_pkr: int, booking_id: str,
              description: str, return_url: str,
              email: str = "", phone: str = "") -> Checkout:
        fields = {
            "txn_ref": txn,
            "amount_pkr": str(amount_pkr),
            "booking_id": booking_id,
            "description": description[:255],
            "return_url": return_url,
        }
        fields["signature"] = sign(fields)
        return Checkout(
            provider=self.name, txn_ref=txn, amount_pkr=amount_pkr,
            post_url="/api/payments/mock/checkout", fields=fields,
            note="Sandbox gateway — no real money moves. Approve or decline on the next screen.",
        )

    def verify(self, payload: dict) -> Verdict:
        received = str(payload.get("signature", ""))
        verified = bool(received) and hmac.compare_digest(received, sign(dict(payload)))
        code = str(payload.get("code", ""))
        return Verdict(
            txn_ref=str(payload.get("txn_ref", "")),
            paid=verified and code == "000",
            code=code,
            message=str(payload.get("message", "")),
            provider_ref=str(payload.get("provider_ref", "")),
            verified=verified,
            raw=dict(payload),
        )
