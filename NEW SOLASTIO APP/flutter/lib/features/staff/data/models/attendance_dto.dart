import '../../../../core/utils/json.dart';

class BreakDto {
  const BreakDto({
    required this.breakType,
    required this.startedAt,
    this.endedAt,
  });
  final String breakType;
  final String startedAt;
  final String? endedAt;

  factory BreakDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return BreakDto(
      breakType: Json.string(map['breakType']) ?? 'regular',
      startedAt: Json.string(map['startedAt']) ?? '',
      endedAt: Json.string(map['endedAt']),
    );
  }

  Map<String, Object?> toJson() => {
    'breakType': breakType,
    'startedAt': startedAt,
    'endedAt': endedAt,
  };
}

class AttendanceDto {
  const AttendanceDto({
    required this.id,
    required this.staffId,
    required this.businessDate,
    required this.clockInAt,
    this.clockOutAt,
    required this.status,
    required this.source,
    required this.grossMinutes,
    this.breaks = const [],
  });
  final String id;
  final String staffId;
  final String businessDate;
  final String clockInAt;
  final String? clockOutAt;
  final String status;
  final String source;
  final int grossMinutes;
  final List<BreakDto> breaks;

  factory AttendanceDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    final rawBreaks = Json.asList(map['breaks']);
    return AttendanceDto(
      id: Json.string(map['id']) ?? '',
      staffId: Json.string(map['staffId']) ?? '',
      businessDate: Json.string(map['businessDate']) ?? '',
      clockInAt: Json.string(map['clockInAt']) ?? '',
      clockOutAt: Json.string(map['clockOutAt']),
      status: Json.string(map['status']) ?? '',
      source: Json.string(map['source']) ?? '',
      grossMinutes: Json.intNum(map['grossMinutes']) ?? 0,
      breaks: rawBreaks.map((b) => BreakDto.fromJson(b)).toList(),
    );
  }

  bool get isClockedIn => clockOutAt == null;

  Map<String, Object?> toJson() => {
    'id': id,
    'staffId': staffId,
    'businessDate': businessDate,
    'clockInAt': clockInAt,
    'clockOutAt': clockOutAt,
    'status': status,
    'source': source,
    'grossMinutes': grossMinutes,
    'breaks': breaks.map((b) => b.toJson()).toList(),
  };
}

class ActiveBreakDto {
  const ActiveBreakDto({
    required this.id,
    required this.status,
    this.startedAt,
  });
  final String id;
  final String status;
  final String? startedAt;

  factory ActiveBreakDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ActiveBreakDto(
      id: Json.string(map['id']) ?? '',
      status: Json.string(map['status']) ?? '',
      startedAt: Json.string(map['startedAt']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'status': status,
    'startedAt': startedAt,
  };
}
