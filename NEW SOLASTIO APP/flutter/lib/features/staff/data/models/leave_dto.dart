import '../../../../core/utils/json.dart';

class LeaveDto {
  const LeaveDto({
    required this.id,
    required this.staffId,
    required this.leaveType,
    required this.startDate,
    required this.endDate,
    required this.reason,
    required this.status,
    required this.version,
  });
  final String id;
  final String staffId;
  final String leaveType;
  final String startDate;
  final String endDate;
  final String reason;
  final String status;
  final int version;

  factory LeaveDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return LeaveDto(
      id: Json.string(map['id']) ?? '',
      staffId: Json.string(map['staffId']) ?? '',
      leaveType: Json.string(map['leaveType']) ?? '',
      startDate: Json.string(map['startDate']) ?? '',
      endDate: Json.string(map['endDate']) ?? '',
      reason: Json.string(map['reason']) ?? '',
      status: Json.string(map['status']) ?? 'pending',
      version: Json.intNum(map['version']) ?? 0,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'staffId': staffId,
    'leaveType': leaveType,
    'startDate': startDate,
    'endDate': endDate,
    'reason': reason,
    'status': status,
    'version': version,
  };
}
