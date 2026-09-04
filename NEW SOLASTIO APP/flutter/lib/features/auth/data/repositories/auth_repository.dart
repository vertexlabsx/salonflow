import '../../../../core/network/api_client.dart';
import '../models/session_response.dart';

/// Request body for `POST /api/v1/auth/login`.
class LoginRequest {
  const LoginRequest({
    required this.tenantId,
    required this.loginId,
    required this.password,
    this.branchId,
    this.deviceType = 'flutter',
  });

  final String tenantId;
  final String loginId;
  final String password;
  final String? branchId;
  final String? deviceType;

  Map<String, Object?> toJson() => {
    'tenantId': tenantId,
    'loginId': loginId,
    'password': password,
    if (branchId != null) 'branchId': branchId,
    'device': {'type': deviceType},
  };
}

/// Request body for `POST /api/v1/auth/refresh`.
class RefreshRequest {
  const RefreshRequest({required this.refreshToken});

  final String refreshToken;

  Map<String, Object?> toJson() => {
    'refreshToken': refreshToken,
    'device': {'type': 'flutter'},
  };
}

/// Request body for `POST /api/v1/auth/logout`.
class LogoutRequest {
  const LogoutRequest({required this.refreshToken});

  final String refreshToken;

  Map<String, Object?> toJson() => {'refreshToken': refreshToken};
}

/// Handles the auth API endpoints. Screens do not call this directly; they
/// go through the session controller.
class AuthRepository {
  final ApiClient _api;

  AuthRepository({required ApiClient api}) : _api = api;

  Future<SessionResponse> login(
    String tenantId,
    String loginId,
    String password, {
    String? branchId,
  }) {
    final request = LoginRequest(
      tenantId: tenantId,
      loginId: loginId,
      password: password,
      branchId: branchId,
    );
    return _api.post<SessionResponse>(
      '/api/v1/auth/login',
      body: request.toJson(),
      fromData: SessionResponse.fromJson,
    );
  }

  Future<SessionResponse> refresh(String refreshToken) {
    final request = RefreshRequest(refreshToken: refreshToken);
    return _api.post<SessionResponse>(
      '/api/v1/auth/refresh',
      body: request.toJson(),
      fromData: SessionResponse.fromJson,
    );
  }

  Future<bool> logout(String refreshToken) {
    final request = LogoutRequest(refreshToken: refreshToken);
    return _api.post<bool>(
      '/api/v1/auth/logout',
      body: request.toJson(),
      fromData: (data) => true,
    );
  }
}
