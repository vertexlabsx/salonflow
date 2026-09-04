import '../../../../core/utils/json.dart';

/// Mirrors the Rust `SessionUser` response object (camelCase).
class SessionUser {
  const SessionUser({
    this.id,
    required this.name,
    this.loginId,
    this.email,
    required this.role,
    this.roleDisplayName,
    this.customRoleName,
    this.staffId,
    this.branchId,
    this.branchIds = const [],
    this.permissions = const [],
    this.staffAppPermissions = const [],
    this.crmPermissions = const [],
  });

  final String? id;
  final String name;
  final String? loginId;
  final String? email;
  final String role;
  final String? roleDisplayName;
  final String? customRoleName;
  final String? staffId;
  final String? branchId;
  final List<String> branchIds;
  final List<String> permissions;
  final List<String> staffAppPermissions;
  final List<String> crmPermissions;

  factory SessionUser.fromJson(Object? json) {
    final map = Json.asMap(json);
    return SessionUser(
      id: Json.string(map['id']),
      name: Json.string(map['name']) ?? '',
      loginId: Json.string(map['loginId']),
      email: Json.string(map['email']),
      role: Json.string(map['role']) ?? 'staff',
      roleDisplayName: Json.string(map['roleDisplayName']),
      customRoleName: Json.string(map['customRoleName']),
      staffId: Json.string(map['staffId']),
      branchId: Json.string(map['branchId']),
      branchIds: Json.stringList(map['branchIds']),
      permissions: Json.stringList(map['permissions']),
      staffAppPermissions: Json.stringList(map['staffAppPermissions']),
      crmPermissions: Json.stringList(map['crmPermissions']),
    );
  }

  String get displayRole =>
      (roleDisplayName ?? customRoleName ?? role).toLowerCase();

  bool hasPermission(String permission) =>
      permissions.contains(permission) ||
      permissions.contains('admin:*') ||
      permissions.contains('*');
}
