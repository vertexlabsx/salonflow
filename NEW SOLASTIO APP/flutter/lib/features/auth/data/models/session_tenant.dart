import '../../../../core/utils/json.dart';

/// Mirrors the Rust `SessionTenant` response object.
class SessionTenant {
  const SessionTenant({this.id, this.name});

  final String? id;
  final String? name;

  factory SessionTenant.fromJson(Object? json) {
    final map = Json.asMap(json);
    return SessionTenant(
      id: Json.string(map['id']),
      name: Json.string(map['name']),
    );
  }
}
