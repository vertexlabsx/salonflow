import '../../../../core/utils/json.dart';
import 'session_tenant.dart';
import 'session_user.dart';

/// Mirrors the Rust `SessionResponse`: `{ accessToken, refreshToken, user, tenant }`.
class SessionResponse {
  const SessionResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.user,
    required this.tenant,
  });

  final String accessToken;
  final String refreshToken;
  final SessionUser user;
  final SessionTenant tenant;

  factory SessionResponse.fromJson(Object? json) {
    final map = Json.asMap(json);
    return SessionResponse(
      accessToken: Json.string(map['accessToken']) ?? '',
      refreshToken: Json.string(map['refreshToken']) ?? '',
      user: SessionUser.fromJson(map['user']),
      tenant: SessionTenant.fromJson(map['tenant']),
    );
  }
}
