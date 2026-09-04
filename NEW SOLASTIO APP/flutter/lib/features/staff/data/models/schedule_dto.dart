import '../../../../core/utils/json.dart';

class ScheduleDto {
  const ScheduleDto({
    required this.id,
    required this.staffId,
    required this.date,
    required this.startAt,
    required this.endAt,
    required this.status,
    required this.version,
    this.shiftName,
  });
  final String id;
  final String staffId;
  final String date;
  final String startAt;
  final String endAt;
  final String status;
  final int version;
  final String? shiftName;

  factory ScheduleDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ScheduleDto(
      id: Json.string(map['id']) ?? '',
      staffId: Json.string(map['staffId']) ?? '',
      date: Json.string(map['date']) ?? '',
      startAt: Json.string(map['startAt']) ?? '',
      endAt: Json.string(map['endAt']) ?? '',
      status: Json.string(map['status']) ?? '',
      version: Json.intNum(map['version']) ?? 0,
      shiftName: Json.string(map['shiftName']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'staffId': staffId,
    'date': date,
    'startAt': startAt,
    'endAt': endAt,
    'status': status,
    'version': version,
    'shiftName': shiftName,
  };
}
