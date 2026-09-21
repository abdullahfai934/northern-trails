"""Easypaisa hosted checkout (Merchant Account / MA).

Easypaisa signs the request differently from JazzCash: the parameter string
is AES-128-ECB encrypted with the store's hash key and base64 encoded, and
that ciphertext travels as `merchantHashedReq`.

The same key decrypts nothing on the way back — Easypaisa's post-back is
validated by recomputing the hash over the returned parameters, so a
tampered callback fails the comparison exactly as it does for JazzCash.
"""
from __future__ import annotations

import base64
import hmac
from datetime import datetime

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from ..config import EASYPAISA_HASH_KEY, EASYPAISA_POST_URL, EASYPAISA_STORE_ID
from .base import Checkout, PaymentProvider, Verdict

SUCCESS_CODES = {"0000", "0"}


def aes_hash(params: dict[str, str], hash_key: str) -> str:
    """AES-128-ECB + base64 over the alphabetically ordered parameter string."""
    ordered = "&".join(f"{k}={params[k]}" for k in sorted(params) if str(params[k]) != "")
    key = hash_key.encode("utf-8")
    if len(key) not in (16, 24, 32):
        # Easypaisa issues 16-byte keys; pad/trim defensively rather than throw.
        key = key.ljust(16, b"0")[:16]
    padder = padding.PKCS7(algorithms.AES.block_size).padder()
    body = padder.update(ordered.encode("utf-8")) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return base64.b64encode(encryptor.update(body) + encryptor.finalize()).decode()


class EasypaisaProvider(PaymentProvider):
    name = "easypaisa"

    def configured(self) -> bool:
        return bool(EASYPAISA_STORE_ID and EASYPAISA_HASH_KEY)

    def start(self, *, txn: str, amount_pkr: int, booking_id: str,
              description: str, return_url: str,
              email: str = "", phone: str = "") -> Checkout:
        params = {
            "amount": f"{int(amount_pkr)}.0",
            "autoRedirect": "1",
            "emailAddr": email,
            "expiryDate": self._expiry(1).strftime("%Y%m%d %H%M%S"),
            "mobileNum": phone,
            "orderRefNum": txn,
            "paymentMethod": "MA_PAYMENT_METHOD",
            "postBackURL": return_url,
            "storeId": EASYPAISA_STORE_ID,
        }
        fields = dict(params)
        fields["merchantHashedReq"] = aes_hash(params, EASYPAISA_HASH_KEY)
        return Checkout(
            provider=self.name, txn_ref=txn, amount_pkr=amount_pkr,
            post_url=EASYPAISA_POST_URL, fields=fields,
            note="Redirects to Easypaisa hosted checkout (Mobile Account).",
        )

    def verify(self, payload: dict) -> Verdict:
        received = str(payload.get("merchantHashedReq", ""))
        check = {k: v for k, v in payload.items()
                 if k not in ("merchantHashedReq", "signature")}
        verified = bool(received) and hmac.compare_digest(
            received, aes_hash(check, EASYPAISA_HASH_KEY))
        code = str(payload.get("status", payload.get("responseCode", "")))
        return Verdict(
            txn_ref=str(payload.get("orderRefNum", "")),
            paid=verified and code in SUCCESS_CODES,
            code=code,
            message=str(payload.get("desc", payload.get("responseDesc", ""))),
            provider_ref=str(payload.get("transactionId", "")),
            verified=verified,
            raw=dict(payload),
        )
