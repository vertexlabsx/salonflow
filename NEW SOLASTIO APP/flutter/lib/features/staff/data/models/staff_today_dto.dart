import '../../../../core/utils/json.dart';
import 'attendance_dto.dart';
import 'task_dto.dart';
import 'schedule_dto.dart';

class StaffTodayResponse {
  const StaffTodayResponse({
    required this.date,
    this.schedules = const [],
    this.attendance = const [],
    this.activeBreak,
    this.tasks = const [],
  });
  final String date;
  final List<ScheduleDto> schedules;
  final List<AttendanceDto> attendance;
  final ActiveBreakDto? activeBreak;
  final List<TaskDto> tasks;

  factory StaffTodayResponse.fromJson(Object? json) {
    final map = Json.asMap(json);
    final rawSchedules = Json.asList(map['schedules']);
    final rawAttendance = Json.asList(map['attendance']);
    final rawTasks = Json.asList(map['tasks']);
    return StaffTodayResponse(
      date: Json.string(map['date']) ?? '',
      schedules: rawSchedules.map((s) => ScheduleDto.fromJson(s)).toList(),
      attendance: rawAttendance.map((a) => AttendanceDto.fromJson(a)).toList(),
      activeBreak: map['activeBreak'] != null
          ? ActiveBreakDto.fromJson(map['activeBreak'])
          : null,
      tasks: rawTasks.map((t) => TaskDto.fromJson(t)).toList(),
    );
  }

  Map<String, Object?> toJson() => {
    'date': date,
    'schedules': schedules.map((s) => s.toJson()).toList(),
    'attendance': attendance.map((a) => a.toJson()).toList(),
    'activeBreak': activeBreak?.toJson(),
    'tasks': tasks.map((t) => t.toJson()).toList(),
  };
}
