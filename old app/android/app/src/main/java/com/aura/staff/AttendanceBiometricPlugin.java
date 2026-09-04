package com.aura.staff;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;
import com.google.android.play.core.integrity.IntegrityTokenResponse;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.SecureRandom;

import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(
    name = "AttendanceBiometric",
    permissions = @Permission(alias = "location", strings = {
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    })
)
public class AttendanceBiometricPlugin extends Plugin {
    private static final String SIGNING_KEY_ALIAS = "aura_attendance_signing_key_v3";
    private static final String STORAGE_KEY_ALIAS = "aura_attendance_storage_key_v1";
    private static final String PREFS_NAME = "aura_secure_attendance";
    private static final String INSTALLATION_ID = "installation_id";
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PluginCall pendingLocationCall;
    private CancellationTokenSource locationCancellation;
    private Runnable locationTimeout;
    private double requestedAccuracy;
    private CachedLocation cachedLocation;

    private static final class CachedLocation {
        final String receipt;
        final double latitude;
        final double longitude;
        final double accuracyMeters;
        final String capturedAt;
        final boolean mockLocation;
        final String integrityVerdict;
        final String integrityToken;
        final long cachedAt;

        CachedLocation(String receipt, Location location, String integrityToken) {
            this.receipt = receipt;
            latitude = location.getLatitude();
            longitude = location.getLongitude();
            accuracyMeters = (double) location.getAccuracy();
            long millis = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
            // Always produce exactly 3 decimal places in UTC to match JavaScript Date.toISOString()
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            capturedAt = sdf.format(new java.util.Date(millis));
            mockLocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? location.isMock() : LocationCompat.isMock(location);
            integrityVerdict = integrityToken != null ? "provided" : "not_provided";
            this.integrityToken = integrityToken;
            cachedAt = System.currentTimeMillis();
        }
    }

    @PluginMethod
    public void getInstallationIdentity(PluginCall call) {
        try {
            if (!ensureSecureLock(call)) return;
            String installationId = getOrCreateInstallationId();
            KeyPair keyPair = getOrCreateSigningKey();
            JSObject result = keyDetails(keyPair);
            result.put("installationId", installationId);
            result.put("algorithm", "ECDSA_P256_SHA256");
            result.put("biometricLabel", "Android biometric or device credential");
            result.put("verificationCapability", "biometric_or_device_credential");
            String[] attestationChain = getAttestationChain();
            result.put("attestationStatus", attestationChain.length > 1 ? "attested" : "unverified");
            result.put("attestationChain", String.join(",", attestationChain));
            call.resolve(result);
        } catch (KeyPermanentlyInvalidatedException error) {
            reject(call, "KEY_INVALIDATED", "The secure lock configuration changed. Re-register this installation.", error, null);
        } catch (Exception error) {
            reject(call, "KEYSTORE_ERROR", "Unable to access the secure attendance identity.", error, null);
        }
    }

    @PluginMethod
    public void requestIntegrityToken(PluginCall call) {
        String nonce = call.getString("nonce");
        if (nonce == null || nonce.isEmpty()) {
            reject(call, "NONCE_REQUIRED", "A nonce is required for integrity verification.", null, null);
            return;
        }
        try {
            IntegrityManager integrityManager = IntegrityManagerFactory.create(getContext());
            IntegrityTokenRequest request = IntegrityTokenRequest.builder()
                .setNonce(nonce)
                .setCloudProjectNumber(0)
                .build();
            integrityManager.requestIntegrityToken(request)
                .addOnSuccessListener(response -> {
                    try {
                        String token = response.token();
                        JSObject result = new JSObject();
                        result.put("integrityToken", token);
                        result.put("integrityVerdict", "provided");
                        call.resolve(result);
                    } catch (Exception error) {
                        reject(call, "INTEGRITY_TOKEN_ERROR", "Failed to extract integrity token.", error, null);
                    }
                })
                .addOnFailureListener(error -> {
                    String message = error.getMessage();
                    String verdict = "failed";
                    if (message != null && message.contains("PLAY_STORE_NOT_FOUND")) {
                        verdict = "play_store_not_found";
                    } else if (message != null && message.contains("API_NOT_AVAILABLE")) {
                        verdict = "api_not_available";
                    }
                    JSObject result = new JSObject();
                    result.put("integrityToken", "");
                    result.put("integrityVerdict", verdict);
                    call.resolve(result);
                });
        } catch (Exception error) {
            reject(call, "INTEGRITY_UNAVAILABLE", "Play Integrity API is unavailable on this device.", error, null);
        }
    }

    @PluginMethod
    public void getDeviceRiskSignals(PluginCall call) {
        JSObject result = new JSObject();
        result.put("rooted", isDeviceRooted());
        result.put("hookDetected", isHookFrameworkDetected());
        result.put("tampered", isAppTampered());
        result.put("emulator", isEmulator());
        call.resolve(result);
    }

    private boolean isDeviceRooted() {
        String[] paths = { "/system/app/Superuser.apk", "/system/xbin/su", "/system/bin/su", "/sbin/su", "/data/local/xbin/su", "/data/local/bin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su" };
        for (String path : paths) { if (new java.io.File(path).exists()) return true; }
        try { Runtime.getRuntime().exec("which su"); return true; } catch (Exception ignored) {}
        try { String tags = Build.TAGS; if (tags != null && tags.contains("test-keys")) return true; } catch (Exception ignored) {}
        return false;
    }

    private boolean isHookFrameworkDetected() {
        try {
            String[] fridaPaths = { "/tmp/frida-server", "/data/local/tmp/frida-server", android.os.Environment.getExternalStorageDirectory().getPath() + "/frida-server" };
            for (String path : fridaPaths) { if (new java.io.File(path).exists()) return true; }
            String maps;
            java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader("/proc/self/maps"));
            StringBuilder sb = new StringBuilder();
            while ((maps = reader.readLine()) != null) sb.append(maps);
            reader.close();
            String mapsContent = sb.toString().toLowerCase(java.util.Locale.ROOT);
            if (mapsContent.contains("frida") || mapsContent.contains("xposed") || mapsContent.contains("substrate") || mapsContent.contains("gadget")) return true;
        } catch (Exception ignored) {}
        return false;
    }

    private boolean isAppTampered() {
        try {
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = info.signingInfo != null ? info.signingInfo.getApkContentsSigners() : null;
            } else {
                @SuppressWarnings("deprecation")
                PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
                @SuppressWarnings("deprecation")
                Signature[] legacySigs = info.signatures;
                sigs = legacySigs;
            }
            if (sigs == null || sigs.length == 0) return true;
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(sigs[0].toByteArray());
            String signingHash = Base64.encodeToString(md.digest(), Base64.NO_WRAP);
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String stored = prefs.getString("app_signing_hash", null);
            if (stored == null) {
                prefs.edit().putString("app_signing_hash", signingHash).apply();
                return false;
            }
            return !stored.equals(signingHash);
        } catch (Exception ignored) { return false; }
    }

    private boolean isEmulator() {
        return Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.startsWith("unknown")
            || Build.MODEL.contains("google_sdk") || Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for x86")
            || Build.MANUFACTURER.contains("Genymotion") || (Build.BRAND.startsWith("generic") && Build.DEVICE.startsWith("generic"))
            || "google_sdk".equals(Build.PRODUCT) || Build.HARDWARE.contains("goldfish") || Build.HARDWARE.contains("ranchu");
    }

    @PluginMethod
    public void capturePreciseLocation(PluginCall call) {
        if (pendingLocationCall != null) {
            reject(call, "OPERATION_IN_PROGRESS", "Another location capture is already active.", null, null);
            return;
        }
        requestedAccuracy = Math.max(1.0, Math.min(500.0, call.getDouble("maxAccuracyMeters", 25.0)));
        pendingLocationCall = call;
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
        } else {
            startLocationCapture(call.getLong("timeoutMs", 20_000L));
        }
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (call != pendingLocationCall) return;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            clearLocationRequest();
            reject(call, "LOCATION_PERMISSION_DENIED", "Precise location permission is required for attendance.", null, null);
            return;
        }
        startLocationCapture(call.getLong("timeoutMs", 20_000L));
    }

    private void startLocationCapture(long requestedTimeoutMs) {
        PluginCall call = pendingLocationCall;
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null || (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            && !manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))) {
            clearLocationRequest();
            reject(call, "LOCATION_DISABLED", "Location services are disabled.", null, null);
            return;
        }
        long timeoutMs = Math.max(5_000L, Math.min(60_000L, requestedTimeoutMs));
        try {
            FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(getContext());
            locationCancellation = new CancellationTokenSource();
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setDurationMillis(timeoutMs)
                .setMaxUpdateAgeMillis(0)
                .build();
            locationTimeout = () -> failLocation(call, "LOCATION_TIMEOUT", "A current precise location was not obtained in time.", null);
            mainHandler.postDelayed(locationTimeout, timeoutMs + 1_000L);
            client.getCurrentLocation(request, locationCancellation.getToken())
                .addOnSuccessListener(location -> completeLocation(call, location))
                .addOnFailureListener(error -> failLocation(call, "LOCATION_UNAVAILABLE", "Current location is unavailable.", error));
        } catch (SecurityException error) {
            failLocation(call, "LOCATION_PERMISSION_DENIED", "Precise location permission is required for attendance.", error);
        } catch (Exception error) {
            failLocation(call, "LOCATION_UNAVAILABLE", "Current location is unavailable.", error);
        }
    }

    private void completeLocation(PluginCall call, Location location) {
        if (call != pendingLocationCall) return;
        if (location == null || !location.hasAccuracy()) {
            failLocation(call, "LOCATION_UNAVAILABLE", "Current location is unavailable.", null);
            return;
        }
        if (location.getAccuracy() > requestedAccuracy) {
            JSObject data = new JSObject();
            data.put("accuracyMeters", location.getAccuracy());
            data.put("maxAccuracyMeters", requestedAccuracy);
            clearLocationRequest();
            reject(call, "LOCATION_ACCURACY_EXCEEDED", "Location accuracy exceeds the attendance policy.", null, data);
            return;
        }
        CachedLocation receipt = new CachedLocation(UUID.randomUUID().toString(), location, null);
        cachedLocation = receipt;
        JSObject result = new JSObject();
        result.put("locationReceipt", receipt.receipt);
        result.put("latitude", receipt.latitude);
        result.put("longitude", receipt.longitude);
        result.put("accuracyMeters", receipt.accuracyMeters);
        result.put("capturedAt", receipt.capturedAt);
        result.put("mockLocation", receipt.mockLocation);
        result.put("integrityVerdict", receipt.integrityVerdict);
        clearLocationRequest();
        call.resolve(result);
    }

    @PluginMethod
    public void verifyUserAndSign(PluginCall call) {
        String payloadBase64 = call.getString("signingPayloadBase64");
        byte[] payload;
        try {
            if (payloadBase64 == null || payloadBase64.isEmpty()) {
                reject(call, "PAYLOAD_REQUIRED", "signingPayloadBase64 is required.", null, null);
                return;
            }
            // Validate and decode the signing payload (supports standard + URL-safe Base64)
            String normalizedBase64 = payloadBase64.trim().replace('-', '+').replace('_', '/');
            payload = Base64.decode(normalizedBase64, Base64.DEFAULT);
            if (payload == null || payload.length == 0) throw new IllegalArgumentException("Empty signing payload after decode");

            // Verify the decoded payload is valid JSON (catches corruption early)
            new JSONObject(new String(payload, StandardCharsets.UTF_8));
        } catch (Exception error) {
            reject(call, "PAYLOAD_INVALID", "The signing payload is invalid or could not be processed.", error, null);
            return;
        }

        // Clear the cached location after successful payload validation
        cachedLocation = null;

        try {
            authenticateAndSign(call, payload, call.getString("reason", "Verify attendance"));
        } catch (Exception error) {
            reject(call, "VERIFICATION_ERROR", error.getMessage() != null ? error.getMessage() : "Biometric verification failed.", error, null);
        }
    }

    private void authenticateAndSign(PluginCall call, byte[] payload, String reason) throws Exception {
        if (!ensureSecureLock(call)) return;
        KeyPair keyPair = getOrCreateSigningKey();
        int authenticators = allowedAuthenticators();
        int status = BiometricManager.from(getContext()).canAuthenticate(authenticators);
        if (status != BiometricManager.BIOMETRIC_SUCCESS) {
            rejectVerificationUnavailable(call, status);
            return;
        }
        java.security.Signature signature = java.security.Signature.getInstance("SHA256withECDSA");
        boolean cryptoPrompt = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q;
        if (cryptoPrompt) signature.initSign(keyPair.getPrivate());

        getActivity().runOnUiThread(() -> {
            try {
                BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) getActivity(), ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            String code = errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_CANCELED
                                || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ? "VERIFICATION_CANCELLED" : "VERIFICATION_ERROR";
                            reject(call, code, errString.toString(), null, null);
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            try {
                                java.security.Signature unlocked = cryptoPrompt && result.getCryptoObject() != null
                                    ? result.getCryptoObject().getSignature() : signature;
                                if (unlocked == null) throw new IllegalStateException("Attendance key was not unlocked");
                                if (!cryptoPrompt) unlocked.initSign(keyPair.getPrivate());
                                unlocked.update(payload);
                                JSObject response = new JSObject();
                                response.put("signatureBase64", Base64.encodeToString(unlocked.sign(), Base64.NO_WRAP));
                                response.put("algorithm", "ECDSA_P256_SHA256");
                                response.put("userVerified", true);
                                java.text.SimpleDateFormat vSdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.ROOT);
                                vSdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
                                response.put("verifiedAt", vSdf.format(new java.util.Date()));
                                cachedLocation = null;
                                call.resolve(response);
                            } catch (Exception error) {
                                reject(call, "SIGNING_ERROR", "Unable to sign the attendance payload.", error, null);
                            }
                        }
                    });
                BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Verify attendance")
                    .setSubtitle(reason)
                    .setAllowedAuthenticators(authenticators);
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) info.setNegativeButtonText("Cancel");
                if (cryptoPrompt) prompt.authenticate(info.build(), new BiometricPrompt.CryptoObject(signature));
                else prompt.authenticate(info.build());
            } catch (Exception error) {
                reject(call, "BIOMETRIC_PROMPT_ERROR", "Failed to display biometric prompt.", error, null);
            }
        });
    }

    private KeyPair getOrCreateSigningKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(SIGNING_KEY_ALIAS)) {
            return new KeyPair(keyStore.getCertificate(SIGNING_KEY_ALIAS).getPublicKey(), (PrivateKey) keyStore.getKey(SIGNING_KEY_ALIAS, null));
        }
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore");
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(SIGNING_KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(30, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            builder.setUserAuthenticationValidityDurationSeconds(30);
        } else {
            builder.setUserAuthenticationValidityDurationSeconds(-1);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                builder.setInvalidatedByBiometricEnrollment(true);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                byte[] attestationChallenge = MessageDigest.getInstance("SHA-256").digest(getOrCreateInstallationId().getBytes(StandardCharsets.UTF_8));
                builder.setAttestationChallenge(attestationChallenge);
                generator.initialize(builder.build());
                return generator.generateKeyPair();
            } catch (Exception ignored) {
                builder.setAttestationChallenge(null);
            }
        }
        generator.initialize(builder.build());
        return generator.generateKeyPair();
    }

    private String[] getAttestationChain() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (!keyStore.containsAlias(SIGNING_KEY_ALIAS)) return new String[0];
            Certificate[] chain = keyStore.getCertificateChain(SIGNING_KEY_ALIAS);
            if (chain == null || chain.length == 0) return new String[0];
            List<String> encoded = new ArrayList<>();
            for (Certificate cert : chain) {
                encoded.add(Base64.encodeToString(cert.getEncoded(), Base64.NO_WRAP));
            }
            return encoded.toArray(new String[0]);
        } catch (Exception ignored) {
            return new String[0];
        }
    }

    private JSObject keyDetails(KeyPair keyPair) throws Exception {
        byte[] publicKey = keyPair.getPublic().getEncoded();
        JSObject result = new JSObject();
        result.put("publicKeySpkiBase64", Base64.encodeToString(publicKey, Base64.NO_WRAP));
        result.put("hardwareBacked", isHardwareBacked(keyPair.getPrivate()));
        return result;
    }

    private boolean isHardwareBacked(PrivateKey key) {
        try {
            KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
            return info.isInsideSecureHardware();
        } catch (Exception ignored) {
            return false;
        }
    }

    private int allowedAuthenticators() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_STRONG;
    }

    private boolean ensureSecureLock(PluginCall call) {
        KeyguardManager manager = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (manager == null || !manager.isDeviceSecure()) {
            reject(call, "NO_SECURE_LOCK", "Set a secure screen lock before registering attendance.", null, null);
            return false;
        }
        return true;
    }

    private String getOrCreateInstallationId() throws Exception {
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String encrypted = preferences.getString(INSTALLATION_ID, null);
        if (encrypted != null) return decryptInstallationId(encrypted);
        String installationId = UUID.randomUUID().toString();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateStorageKey());
        byte[] ciphertext = cipher.doFinal(installationId.getBytes(StandardCharsets.UTF_8));
        String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        if (!preferences.edit().putString(INSTALLATION_ID, stored).commit()) throw new IllegalStateException("Secure storage write failed");
        return installationId;
    }

    private String decryptInstallationId(String stored) throws Exception {
        String[] parts = stored.split("\\.", 2);
        if (parts.length != 2) throw new IllegalStateException("Invalid secure storage value");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateStorageKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private SecretKey getOrCreateStorageKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(STORAGE_KEY_ALIAS)) return (SecretKey) keyStore.getKey(STORAGE_KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(STORAGE_KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build(), new SecureRandom());
        return generator.generateKey();
    }

    private void rejectVerificationUnavailable(PluginCall call, int status) {
        String code = status == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED ? "VERIFICATION_NOT_ENROLLED" : "VERIFICATION_UNAVAILABLE";
        reject(call, code, "Secure biometric or device credential verification is unavailable.", null, null);
    }

    private void failLocation(PluginCall call, String code, String message, Exception error) {
        if (call != pendingLocationCall) return;
        clearLocationRequest();
        reject(call, code, message, error, null);
    }

    private void clearLocationRequest() {
        if (locationTimeout != null) mainHandler.removeCallbacks(locationTimeout);
        if (locationCancellation != null) locationCancellation.cancel();
        locationTimeout = null;
        locationCancellation = null;
        pendingLocationCall = null;
    }

    private void reject(PluginCall call, String code, String message, Exception error, JSObject data) {
        if (call == null || call.isReleased()) return;
        call.reject(message, code, error, data);
    }
}
