"""JazzCash hosted checkout.

Flow: we build a form of pp_* fields, sign it, and the browser POSTs it to
JazzCash. The customer pays with a Mobile Account or card, and JazzCash
POSTs back to pp_ReturnURL with the same field set plus a response code.

The secure hash is an HMAC-SHA256 over the integrity salt followed by every
non-empty field value, ordered by field name, joined with '&'. The same
routine signs the request and validates the callback — a callback whose
recomputed hash does not match is treated as unverified and never confirms
a booking, which is what stops a forged "payment successful" redirect.
"""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime

from ..config import (JAZZCASH_INTEGRITY_SALT, JAZZCASH_MERCHANT_ID,
                      JAZZCASH_PASSWORD, JAZZCASH_POST_URL)
from .base import Checkout, PaymentProvider, Verdict

SUCCESS_CODES = {"000", "121"}      # 000 = success, 121 = already-paid


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S")


def secure_hash(fields: dict[str, str], salt: str) -> str:
    """HMAC-SHA256 over salt + every non-empty value, sorted by key."""
    parts = [salt]
    for key in sorted(fields):
        if key.lower() == "pp_securehash":
            continue
        value = str(fields.get(key, "") or "").strip()
        if value:
            parts.append(value)
    message = "&".join(parts)
    return hmac.new(salt.encode(), message.encode(), hashlib.sha256).hexdigest().upper()


class JazzCashProvider(PaymentProvider):
    name = "jazzcash"

    def configured(self) -> bool:
        return bool(JAZZCASH_MERCHANT_ID and JAZZCASH_PASSWORD and JAZZCASH_INTEGRITY_SALT)

    def start(self, *, txn: str, amount_pkr: int, booking_id: str,
              description: str, return_url: str,
              email: str = "", phone: str = "") -> Checkout:
        now = datetime.now()
        fields = {
            "pp_Version": "1.1",
            "pp_TxnType": "MWALLET",
            "pp_Language": "EN",
            "pp_MerchantID": JAZZCASH_MERCHANT_ID,
            "pp_SubMerchantID": "",
            "pp_Password": JAZZCASH_PASSWORD,
            "pp_BankID": "",
            "pp_ProductID": "",
            "pp_TxnRefNo": txn,
            # JazzCash takes the amount in paisa, with no decimal point.
            "pp_Amount": str(int(amount_pkr) * 100),
            "pp_TxnCurrency": "PKR",
            "pp_TxnDateTime": _stamp(now),
            "pp_BillReference": booking_id,
            "pp_Description": description[:255],
            "pp_TxnExpiryDateTime": _stamp(self._expiry(1).astimezone()),
            "pp_ReturnURL": return_url,
            "ppmpf_1": phone,
            "ppmpf_2": email,
            "ppmpf_3": booking_id,
            "ppmpf_4": "",
            "ppmpf_5": "",
        }
        fields["pp_SecureHash"] = secure_hash(fields, JAZZCASH_INTEGRITY_SALT)
        return Checkout(
            provider=self.name, txn_ref=txn, amount_pkr=amount_pkr,
            post_url=JAZZCASH_POST_URL, fields=fields,
            note="Redirects to JazzCash hosted checkout (Mobile Account or card).",
        )

    def verify(self, payload: dict) -> Verdict:
        received = str(payload.get("pp_SecureHash", "")).upper()
        expected = secure_hash(payload, JAZZCASH_INTEGRITY_SALT)
        verified = bool(received) and hmac.compare_digest(received, expected)
        code = str(payload.get("pp_ResponseCode", ""))
        return Verdict(
            txn_ref=str(payload.get("pp_TxnRefNo", "")),
            # An unverified callback never counts as paid, whatever it claims.
            paid=verified and code in SUCCESS_CODES,
            code=code,
            message=str(payload.get("pp_ResponseMessage", "")),
            provider_ref=str(payload.get("pp_RetreivalReferenceNo", "")),
            verified=verified,
            raw=dict(payload),
        )
