import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/session_user.dart';
import '../data/repositories/auth_repository.dart';
import '../../../core/storage/token_storage.dart';

/// Authentication lifecycle state and controller.
///
/// This is the single source of truth for "are we signed in as whom". It owns
/// tokens, session restoration, login, logout and 401 refresh handling.
class SessionController extends StateNotifier<SessionState> {
  final AuthRepository _auth;
  final TokenStorage _storage;

  SessionController({
    required AuthRepository auth,
    required TokenStorage storage,
  }) : _auth = auth,
       _storage = storage,
       super(SessionState.signedOut());

  /// Restores a previously persisted session at app start.
  /// Never throws; failures leave us signed out.
  Future<void> restore() async {
    final user = await _storage.sessionUser();
    final access = await _storage.accessToken();
    final refresh = await _storage.refreshToken();
    if (user == null || access == null || refresh == null) {
      state = SessionState.signedOut();
      return;
    }
    state = SessionState.signedIn(
      accessToken: access,
      refreshToken: refresh,
      user: SessionUser.fromJson(user),
    );
  }

  Future<void> login({
    required String tenantId,
    required String loginId,
    required String password,
  }) async {
    state = SessionState.signingIn();
    try {
      final session = await _auth.login(tenantId, loginId, password);
      await _storage.persistTokens(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      );
      await _storage.persistSessionUser(_userToMap(session.user));
      state = SessionState.signedIn(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: session.user,
      );
    } on Object catch (e) {
      state = SessionState.signInFailed(e);
      rethrow;
    }
  }

  Future<void> logout() async {
    final refresh = state.refreshToken;
    if (refresh != null && refresh.isNotEmpty) {
      try {
        await _auth.logout(refresh);
      } catch (_) {
        // Best-effort: local logout must still complete.
      }
    }
    await _storage.clearAll();
    state = SessionState.signedOut();
  }

  /// Invoked by the [ApiClient] on a 401. Tries a single token refresh; on
  /// failure we sign out.
  Future<void> handleUnauthorized() async {
    final refresh = state.refreshToken;
    if (refresh == null || refresh.isEmpty) {
      await logout();
      return;
    }
    try {
      final session = await _auth.refresh(refresh);
      await _storage.persistTokens(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      );
      await _storage.persistSessionUser(_userToMap(session.user));
      state = SessionState.signedIn(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        user: session.user,
      );
    } catch (_) {
      await logout();
    }
  }

  Map<String, Object> _userToMap(SessionUser user) {
    return {
      'id': user.id ?? '',
      'name': user.name,
      'loginId': user.loginId ?? '',
      if (user.email != null) 'email': user.email as Object,
      'role': user.role,
      if (user.roleDisplayName != null)
        'roleDisplayName': user.roleDisplayName as Object,
      if (user.customRoleName != null)
        'customRoleName': user.customRoleName as Object,
      if (user.staffId != null) 'staffId': user.staffId as Object,
      if (user.branchId != null) 'branchId': user.branchId as Object,
      'branchIds': user.branchIds,
      'permissions': user.permissions,
      'staffAppPermissions': user.staffAppPermissions,
      'crmPermissions': user.crmPermissions,
    };
  }
}

enum SessionStatus { initial, signingIn, signedIn, signedOut, signInFailed }

/// Immutable authentication state exposed to the UI and route guards.
class SessionState {
  SessionState(
    this.status, {
    this.accessToken,
    this.refreshToken,
    this.user,
    this.error,
  });

  factory SessionState.signedOut() => SessionState(SessionStatus.signedOut);

  factory SessionState.signingIn() => SessionState(SessionStatus.signingIn);

  factory SessionState.signInFailed(Object? error) =>
      SessionState(SessionStatus.signInFailed, error: error);

  factory SessionState.signedIn({
    String? accessToken,
    String? refreshToken,
    SessionUser? user,
  }) => SessionState(
    SessionStatus.signedIn,
    accessToken: accessToken,
    refreshToken: refreshToken,
    user: user,
  );

  final SessionStatus status;
  final String? accessToken;
  final String? refreshToken;
  final SessionUser? user;
  final Object? error;

  bool get isSignedIn => status == SessionStatus.signedIn;
  bool get isSigningIn => status == SessionStatus.signingIn;
}
