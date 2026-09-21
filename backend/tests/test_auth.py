"""Firebase ID-token verification.

These are the checks that stop a forged or replayed token being accepted
as a signed-in user, so each failure mode gets its own test.
"""
import datetime
import time

import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

import app.auth as auth

PROJECT = "northern-trails-test"
KID = "test-kid-1"


@pytest.fixture
def signer(monkeypatch):
    """A throwaway keypair standing in for Google's signing key."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=5))
            .not_valid_after(now + datetime.timedelta(days=1))
            .sign(key, hashes.SHA256()))
    pem = cert.public_bytes(serialization.Encoding.PEM).decode()

    monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", PROJECT)
    monkeypatch.setattr(auth, "FIREBASE_AUTH_EMULATOR_HOST", "")
    monkeypatch.setattr(auth, "_certs", {KID: pem})
    monkeypatch.setattr(auth, "_certs_expire_at", time.time() + 3600)

    priv = key.private_bytes(serialization.Encoding.PEM,
                             serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())

    def mint(**over):
        iat = int(time.time())
        claims = {"sub": "uid-abc", "user_id": "uid-abc",
                  "phone_number": "+923001234567",
                  "aud": PROJECT,
                  "iss": f"https://securetoken.google.com/{PROJECT}",
                  "iat": iat, "exp": iat + 3600}
        claims.update(over)
        return jwt.encode(claims, priv, algorithm="RS256", headers={"kid": KID})

    return mint


async def test_valid_token_is_accepted(signer):
    claims = await auth.verify_id_token(signer())
    assert claims["user_id"] == "uid-abc"
    assert claims["phone_number"] == "+923001234567"


async def test_wrong_audience_is_rejected(signer):
    with pytest.raises(jwt.InvalidAudienceError):
        await auth.verify_id_token(signer(aud="some-other-project"))


async def test_wrong_issuer_is_rejected(signer):
    with pytest.raises(jwt.InvalidIssuerError):
        await auth.verify_id_token(signer(iss="https://evil.example.com/x"))


async def test_expired_token_is_rejected(signer):
    with pytest.raises(jwt.ExpiredSignatureError):
        await auth.verify_id_token(signer(exp=int(time.time()) - 60))


async def test_token_signed_by_another_key_is_rejected(signer):
    """The core forgery case: right claims, wrong signer."""
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = other.private_bytes(serialization.Encoding.PEM,
                              serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption())
    iat = int(time.time())
    forged = jwt.encode(
        {"sub": "attacker", "aud": PROJECT,
         "iss": f"https://securetoken.google.com/{PROJECT}",
         "iat": iat, "exp": iat + 600},
        pem, algorithm="RS256", headers={"kid": KID})
    with pytest.raises(jwt.InvalidSignatureError):
        await auth.verify_id_token(forged)


async def test_garbage_token_is_rejected(signer):
    with pytest.raises(Exception):
        await auth.verify_id_token("not.a.real.token")


async def test_auth_disabled_yields_an_anonymous_identity(monkeypatch):
    monkeypatch.setattr(auth, "FIREBASE_PROJECT_ID", "")
    identity = await auth.current_user("")
    assert identity.anonymous and identity.uid == "anon"
