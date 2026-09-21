"""Payment signing and, more importantly, callback forgery rejection."""
import pytest

import app.config as cfg
import app.payments.easypaisa as ep
import app.payments.jazzcash as jc
import app.payments.mock as mk
from app.payments.base import txn_ref

SALT = "SALT9876"


@pytest.fixture(autouse=True)
def creds(monkeypatch):
    for mod, attrs in (
        (jc, {"JAZZCASH_MERCHANT_ID": "MC12345", "JAZZCASH_PASSWORD": "pw123",
              "JAZZCASH_INTEGRITY_SALT": SALT}),
        (ep, {"EASYPAISA_STORE_ID": "12345", "EASYPAISA_HASH_KEY": "ABCDEF0123456789"}),
    ):
        for k, v in attrs.items():
            monkeypatch.setattr(mod, k, v, raising=False)
            monkeypatch.setattr(cfg, k, v, raising=False)


def _checkout(provider):
    return provider.start(
        txn="NT260921120000AB01", amount_pkr=62000, booking_id="NT-SKARDU-2481",
        description="Skardu, Deosai & Sheosar Lake",
        return_url="http://localhost:5173/pay/return",
        email="a@b.com", phone="03001234567")


# --------------------------------------------------------------- JazzCash
def test_jazzcash_converts_rupees_to_paisa():
    """A rupee amount sent as-is would undercharge by 100x."""
    assert _checkout(jc.JazzCashProvider()).fields["pp_Amount"] == "6200000"


def test_jazzcash_hash_is_deterministic_and_order_independent():
    fields = {"pp_B": "2", "pp_A": "1", "pp_C": ""}
    assert jc.secure_hash(fields, SALT) == jc.secure_hash(
        {"pp_C": "", "pp_A": "1", "pp_B": "2"}, SALT)


def test_jazzcash_accepts_a_genuine_success_callback():
    p = jc.JazzCashProvider()
    cb = {k: v for k, v in _checkout(p).fields.items() if k != "pp_SecureHash"}
    cb.update({"pp_ResponseCode": "000", "pp_ResponseMessage": "Thank you"})
    cb["pp_SecureHash"] = jc.secure_hash(cb, SALT)
    v = p.verify(cb)
    assert v.verified and v.paid and v.status == "paid"


def test_jazzcash_rejects_a_tampered_amount():
    """The attack this guards: flip a declined callback to success, or
    lower the amount, without re-signing."""
    p = jc.JazzCashProvider()
    cb = {k: v for k, v in _checkout(p).fields.items() if k != "pp_SecureHash"}
    cb.update({"pp_ResponseCode": "000"})
    cb["pp_SecureHash"] = jc.secure_hash(cb, SALT)
    cb["pp_Amount"] = "100"                      # tamper after signing
    v = p.verify(cb)
    assert not v.verified and not v.paid


def test_jazzcash_genuine_decline_is_verified_but_unpaid():
    p = jc.JazzCashProvider()
    cb = {k: v for k, v in _checkout(p).fields.items() if k != "pp_SecureHash"}
    cb.update({"pp_ResponseCode": "124", "pp_ResponseMessage": "Insufficient balance"})
    cb["pp_SecureHash"] = jc.secure_hash(cb, SALT)
    v = p.verify(cb)
    assert v.verified and not v.paid


def test_jazzcash_callback_without_a_hash_is_never_paid():
    p = jc.JazzCashProvider()
    assert not p.verify({"pp_TxnRefNo": "X", "pp_ResponseCode": "000"}).paid


# -------------------------------------------------------------- Easypaisa
def test_easypaisa_hash_is_deterministic():
    p = ep.EasypaisaProvider()
    fields = _checkout(p).fields
    recomputed = ep.aes_hash(
        {k: v for k, v in fields.items() if k != "merchantHashedReq"},
        "ABCDEF0123456789")
    assert fields["merchantHashedReq"] == recomputed


def test_easypaisa_rejects_tampered_callback():
    p = ep.EasypaisaProvider()
    fields = dict(_checkout(p).fields)
    fields["status"] = "0000"
    fields["amount"] = "1.0"                      # tamper
    assert not p.verify(fields).paid


# ------------------------------------------------------------------- mock
def test_mock_gateway_round_trip():
    p = mk.MockProvider()
    f = dict(_checkout(p).fields)
    f.update({"code": "000", "message": "Approved"})
    f.pop("signature", None)
    f["signature"] = mk.sign(f)
    v = p.verify(f)
    assert v.verified and v.paid


def test_mock_gateway_rejects_forgery():
    p = mk.MockProvider()
    f = dict(_checkout(p).fields)
    f.update({"code": "000", "signature": "deadbeef"})
    assert not p.verify(f).paid


def test_txn_refs_are_unique_per_attempt():
    """Regression: 4 hex chars of entropy collided within 200 draws, and
    this value is the payments-table primary key."""
    refs = [txn_ref() for _ in range(50_000)]
    assert len(set(refs)) == len(refs)


def test_txn_ref_fits_the_jazzcash_field_limit():
    """pp_TxnRefNo is capped at 20 characters by the gateway."""
    assert all(len(txn_ref()) <= 20 for _ in range(1000))


# ---------------------------------------------------------------- registry
def test_provider_falls_back_to_mock_when_unconfigured(monkeypatch):
    from app import payments
    monkeypatch.setattr(jc, "JAZZCASH_MERCHANT_ID", "", raising=False)
    assert payments.get_provider("jazzcash").name == "mock"
