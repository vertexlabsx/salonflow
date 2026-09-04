use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use mongodb::bson::Document;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use sha2::Sha256;
use solastio_shared::{config::AppConfig, error::AppError};
use std::sync::Arc;

use crate::AppState;

type HmacSha256 = Hmac<Sha256>;

fn b64url_decode(value: &str) -> Result<Vec<u8>, AppError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| AppError::Validation("Invalid base64url value.".to_string()))
}

fn b64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn decode_vapid_keys(config: &AppConfig) -> Result<(Vec<u8>, Vec<u8>), AppError> {
    let public_key = config
        .web_push_public_key
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    let private_key = config
        .web_push_private_key
        .as_deref()
        .ok_or(AppError::ExternalService)?;
    Ok((b64url_decode(public_key)?, b64url_decode(private_key)?))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key length is valid");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hkdf_extract(salt: &[u8], ikm: &[u8]) -> Vec<u8> {
    hmac_sha256(salt, ikm)
}

fn hkdf_expand(prk: &[u8], info: &[u8], length: usize) -> Vec<u8> {
    let mut output = Vec::new();
    let mut previous = Vec::new();
    let mut counter: u8 = 1;
    while output.len() < length {
        let mut block = previous.clone();
        block.extend_from_slice(info);
        block.push(counter);
        previous = hmac_sha256(prk, &block);
        output.extend_from_slice(&previous);
        counter += 1;
    }
    output.truncate(length);
    output
}

fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], length: usize) -> Vec<u8> {
    let prk = hkdf_extract(salt, ikm);
    hkdf_expand(&prk, info, length)
}

/// Builds a VAPID ES256 JWT (RFC 8292). The signature is the raw R||S
/// concatenation (64 bytes), matching common web-push client libraries.
fn build_vapid_jwt(config: &AppConfig, audience: &str) -> Result<String, AppError> {
    let (_public, private) = decode_vapid_keys(config)?;
    let now = chrono::Utc::now().timestamp();
    let header = b64url_encode(
        serde_json::json!({ "typ": "JWT", "alg": "ES256" })
            .to_string()
            .as_bytes(),
    );
    let claims = b64url_encode(
        serde_json::json!({
            "aud": audience,
            "exp": now + 12 * 3600,
            "sub": "mailto:support@aura-salon.app",
        })
        .to_string()
        .as_bytes(),
    );
    let signing_input = format!("{}.{}", header, claims);
    let signing_key = SigningKey::from_slice(&private).map_err(|_| AppError::ExternalService)?;
    let signature: Signature = signing_key.sign(signing_input.as_bytes());
    let sig = signature.to_bytes();
    Ok(format!("{}.{}", signing_input, b64url_encode(&sig)))
}

/// Computes the ECDH shared secret between an ephemeral server key pair and the
/// subscriber's public P-256 key.
fn ecdh_shared_secret(subscriber_public: &[u8]) -> Result<(Vec<u8>, Vec<u8>), AppError> {
    use p256::ecdh::EphemeralSecret;
    let server_secret = EphemeralSecret::random(&mut rand::rngs::OsRng);
    let server_public = p256::PublicKey::from(server_secret.public_key());
    let server_public_bytes: Vec<u8> = server_public.to_encoded_point(false).as_bytes().to_vec();
    let subscriber = p256::PublicKey::from_sec1_bytes(subscriber_public)
        .map_err(|_| AppError::ExternalService)?;
    let shared = server_secret.diffie_hellman(&subscriber);
    Ok((shared.raw_secret_bytes().to_vec(), server_public_bytes))
}

/// RFC 8291 encrypts `plaintext` for a web-push subscription and returns
/// (ciphertext, salt, server_public_key_full), all raw bytes.
type EncryptedPayload = (Vec<u8>, Vec<u8>, Vec<u8>);

fn encrypt_payload(
    subscriber_p256dh: &[u8],
    subscriber_auth: &[u8],
    plaintext: &[u8],
) -> Result<EncryptedPayload, AppError> {
    use rand::RngCore;

    let (ecdh_secret, server_public_bytes) = ecdh_shared_secret(subscriber_p256dh)?;

    let mut salt = vec![0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);

    // key_info = "WebPush: info\x00" || ua_public(65) || as_public(65)
    let mut key_info = b"WebPush: info\x00".to_vec();
    key_info.extend_from_slice(subscriber_p256dh);
    key_info.extend_from_slice(&server_public_bytes);

    // ikm = HKDF(salt=auth_secret, ikm=ecdh_secret, info=key_info, L=32)
    let ikm = hkdf(subscriber_auth, &ecdh_secret, &key_info, 32);

    // prk = HKDF-Extract(salt, ikm)
    let prk = hkdf_extract(&salt, &ikm);

    // CEK = HKDF-Expand(prk, "Content-Encoding: aes128gcm", 16)
    let cek_info = b"Content-Encoding: aes128gcm".to_vec();
    let cek = hkdf_expand(&prk, &cek_info, 16);

    // NONCE = HKDF-Expand(prk, "Content-Encoding: nonce", 12)
    let nonce_info = b"Content-Encoding: nonce".to_vec();
    let nonce = hkdf_expand(&prk, &nonce_info, 12);

    // aes128gcm record header: salt(16) || rs(4 = 4096) || idlen(1 = 0)
    let mut aad = salt.clone();
    aad.extend_from_slice(&4096u32.to_be_bytes());
    aad.push(0u8);

    // record: pad_len(1) || plaintext  (zero padding)
    let mut record = vec![0u8];
    record.extend_from_slice(plaintext);

    use aes_gcm::aead::{Aead, KeyInit, Payload};
    let cipher = aes_gcm::Aes128Gcm::new_from_slice(&cek).map_err(|_| AppError::ExternalService)?;
    let nonce_ref = aes_gcm::Nonce::from_slice(&nonce);
    let ciphertext = cipher
        .encrypt(
            nonce_ref,
            Payload {
                msg: &record,
                aad: &aad,
            },
        )
        .map_err(|_| AppError::ExternalService)?;

    Ok((ciphertext, salt, server_public_bytes))
}

fn extract_audience(endpoint: &str) -> Result<String, AppError> {
    let url = url::Url::parse(endpoint).map_err(|_| AppError::ExternalService)?;
    Ok(format!(
        "{}://{}",
        url.scheme(),
        url.host_str().unwrap_or_default()
    ))
}

pub struct PushNotification {
    pub title: String,
    pub body: String,
    pub tag: Option<String>,
    pub data: serde_json::Value,
}

impl PushNotification {
    fn to_payload(&self) -> serde_json::Value {
        let mut payload = serde_json::json!({ "title": self.title, "body": self.body });
        if let Some(tag) = &self.tag {
            payload["tag"] = serde_json::Value::String(tag.clone());
        }
        payload["data"] = self.data.clone();
        payload
    }
}

pub async fn send_notification_to_device(
    config: &AppConfig,
    device: &Document,
    notification: &PushNotification,
) -> Result<(), AppError> {
    let subscription = device
        .get_document("subscription")
        .map_err(|_| AppError::ExternalService)?;
    let endpoint = subscription
        .get_str("endpoint")
        .map_err(|_| AppError::ExternalService)?;
    let keys = subscription
        .get_document("keys")
        .map_err(|_| AppError::ExternalService)?;
    let p256dh = keys
        .get_str("p256dh")
        .map_err(|_| AppError::ExternalService)?;
    let auth = keys
        .get_str("auth")
        .map_err(|_| AppError::ExternalService)?;
    let p256dh_bytes = b64url_decode(p256dh)?;
    let auth_bytes = b64url_decode(auth)?;

    let audience = extract_audience(endpoint)?;
    let (public_key, _private_key) = decode_vapid_keys(config)?;
    let jwt = build_vapid_jwt(config, &audience)?;
    let auth_header = format!("vapid t={}, k={}", jwt, b64url_encode(&public_key));

    let plaintext = notification.to_payload().to_string().into_bytes();
    let (ciphertext, _salt, server_public) =
        encrypt_payload(&p256dh_bytes, &auth_bytes, &plaintext)?;

    let crypto_key = format!(
        "p256ecdsa={}; dh={}",
        b64url_encode(&public_key),
        b64url_encode(&server_public)
    );

    let response = reqwest::Client::new()
        .post(endpoint)
        .header("TTL", "3600")
        .header("Authorization", auth_header)
        .header("Crypto-Key", crypto_key)
        .header("Content-Encoding", "aes128gcm")
        .body(ciphertext)
        .send()
        .await
        .map_err(|_| AppError::ExternalService)?;
    let status = response.status().as_u16();
    if status == 404 || status == 410 {
        return Err(AppError::NotFound("push device gone".to_string()));
    }
    if !response.status().is_success() {
        return Err(AppError::ExternalService);
    }
    Ok(())
}

/// Sends a notification to every registered subscription of a user. Devices that
/// return 404/410 are removed. Returns the number of devices attempted.
pub async fn send_push_to_user(
    state: &Arc<AppState>,
    salon_id: &str,
    user_id: &str,
    notification: &PushNotification,
) -> Result<usize, AppError> {
    if state
        .config
        .web_push_private_key
        .as_deref()
        .unwrap_or("")
        .is_empty()
    {
        return Ok(0);
    }
    let devices = state
        .push_devices
        .devices_for_user(salon_id, user_id)
        .await?;
    let mut attempted = 0;
    for device in &devices {
        match send_notification_to_device(&state.config, device, notification).await {
            Err(AppError::NotFound(_)) => {
                if let Some(oid) = device.get("_id").and_then(|value| value.as_object_id()) {
                    let _ = state.push_devices.delete_device(&oid.to_hex()).await;
                }
            }
            Ok(_) => attempted += 1,
            Err(_) => {}
        }
    }
    Ok(attempted)
}

/// Resolves a staff profile to its login user, then sends the push.
pub async fn notify_staff_by_staff_id(
    state: Arc<AppState>,
    salon_id: String,
    staff_id: String,
    notification: PushNotification,
) -> Result<(), AppError> {
    if let Some(user_id) = state
        .users
        .find_user_id_by_staff(&salon_id, &staff_id)
        .await?
    {
        let _ = send_push_to_user(&state, &salon_id, &user_id, &notification).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc8291_encapsulation_shapes_are_correct() {
        // A real on-curve subscriber P-256 public key (65-byte uncompressed point).
        let subscriber_secret = p256::SecretKey::random(&mut rand::rngs::OsRng);
        let subscriber_public = subscriber_secret.public_key();
        let subscriber_p256dh = subscriber_public
            .to_encoded_point(false)
            .as_bytes()
            .to_vec();
        let subscriber_auth = b"authsecret012345";
        let plaintext = b"{\"title\":\"hi\",\"body\":\"yo\"}".to_vec();
        let (ciphertext, salt, server_public) =
            encrypt_payload(&subscriber_p256dh, subscriber_auth, &plaintext).expect("encrypts");
        // salt == 16 bytes, server public == 65 bytes uncompressed point.
        assert_eq!(salt.len(), 16);
        assert_eq!(server_public.len(), 65);
        // record = pad_len(1) + plaintext + 16-byte GCM tag.
        assert_eq!(ciphertext.len(), plaintext.len() + 1 + 16);
    }

    #[test]
    fn hkdf_is_deterministic() {
        let a = hkdf(b"salt", b"ikm", b"info", 32);
        let b = hkdf(b"salt", b"ikm", b"info", 32);
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }
}
