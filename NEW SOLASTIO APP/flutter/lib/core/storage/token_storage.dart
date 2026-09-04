import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:logger/logger.dart';

import '../constants/app_constants.dart';

/// Stores sensitive tokens and the serialized session in the platform secure
/// store (Keychain / Credential Locker / GNOME Keyring).
///
/// Non-sensitive, non-secret values (like last branch selection) must live
/// elsewhere; tokens never go in plain storage.
class TokenStorage {
  final FlutterSecureStorage _store;
  final Logger _log;

  TokenStorage({FlutterSecureStorage? store})
    : _store = store ?? FlutterSecureStorage(),
      _log = Logger(level: Level.info);

  Future<String?> accessToken() => read(AppConstants.storageKeyAccessToken);
  Future<String?> refreshToken() => read(AppConstants.storageKeyRefreshToken);
  Future<Map<String, Object>?> sessionUser() =>
      readMap(AppConstants.storageKeySessionUser);

  Future<void> persistTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await write(AppConstants.storageKeyAccessToken, accessToken);
    await write(AppConstants.storageKeyRefreshToken, refreshToken);
  }

  Future<void> persistSessionUser(Map<String, Object> user) async {
    await write(AppConstants.storageKeySessionUser, jsonEncode(user));
  }

  Future<void> clearAll() async {
    for (final key in [
      AppConstants.storageKeyAccessToken,
      AppConstants.storageKeyRefreshToken,
      AppConstants.storageKeySessionUser,
    ]) {
      try {
        await _store.delete(key: key);
      } catch (_) {
        // Best-effort: ignore missing keys during clear.
      }
    }
  }

  Future<Map<String, Object>?> readMap(String key) async {
    final raw = await read(key);
    if (raw == null) return null;
    try {
      return jsonDecode(raw) as Map<String, Object>;
    } catch (_) {
      _log.i('Corrupt stored value for $key');
      return null;
    }
  }

  Future<String?> read(String key) async {
    try {
      return await _store.read(key: key);
    } catch (e) {
      _log.i('Secure read failed for $key: $e');
      return null;
    }
  }

  Future<void> write(String key, String value) async {
    try {
      await _store.write(key: key, value: value);
    } catch (e) {
      _log.e('Secure write failed for $key', error: e);
      rethrow;
    }
  }
}
