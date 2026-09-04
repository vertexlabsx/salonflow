import '../../../../core/network/api_client.dart';
import '../models/attendance_dto.dart';
import '../models/task_dto.dart';
import '../models/leave_dto.dart';
import '../models/payslip_dto.dart';
import '../models/staff_today_dto.dart';

class StaffOsRepository {
  final ApiClient _api;
  StaffOsRepository({required ApiClient api}) : _api = api;

  Future<StaffTodayResponse> fetchToday({String? date}) {
    final query = <String, String>{};
    if (date != null) query['date'] = date;
    return _api.get<StaffTodayResponse>(
      '/api/v1/staff-os/mobile/today',
      query: query,
      fromData: StaffTodayResponse.fromJson,
    );
  }

  Future<List<AttendanceDto>> fetchAttendance({
    String? date,
    String? from,
    String? to,
    int? limit,
  }) {
    final query = <String, String>{};
    if (date != null) query['date'] = date;
    if (from != null) query['from'] = from;
    if (to != null) query['to'] = to;
    if (limit != null) query['limit'] = limit.toString();
    return _api.get<List<AttendanceDto>>(
      '/api/v1/staff-os/attendance',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => AttendanceDto.fromJson(e)).toList();
      },
    );
  }

  Future<AttendanceDto> clockIn({String? source}) {
    return _api.post<AttendanceDto>(
      '/api/v1/staff-os/attendance/clock-in',
      body: {'source': source ?? 'staff-app'},
      fromData: AttendanceDto.fromJson,
    );
  }

  Future<AttendanceDto> clockOut({required String attendanceId}) {
    return _api.post<AttendanceDto>(
      '/api/v1/staff-os/attendance/clock-out',
      body: {'attendanceId': attendanceId},
      fromData: AttendanceDto.fromJson,
    );
  }

  Future<ActiveBreakDto> startBreak({String breakType = 'regular'}) {
    return _api.post<ActiveBreakDto>(
      '/api/v1/staff-os/attendance/break-start',
      body: {'breakType': breakType},
      fromData: ActiveBreakDto.fromJson,
    );
  }

  Future<void> endBreak({required String breakId}) {
    return _api.post<void>(
      '/api/v1/staff-os/attendance/break-end',
      body: {'breakId': breakId},
      fromData: (_) {},
    );
  }

  Future<List<TaskDto>> fetchTasks({int? limit}) {
    return fetchToday().then(
      (today) => today.tasks.take(limit ?? today.tasks.length).toList(),
    );
  }

  Future<List<PayslipDto>> fetchPayroll({int? limit}) {
    final query = <String, String>{};
    if (limit != null) query['limit'] = limit.toString();
    return _api.get<List<PayslipDto>>(
      '/api/v1/staff-os/mobile/payroll',
      query: query,
      fromData: (data) {
        if (data is List) return data.map(PayslipDto.fromJson).toList();
        final map = data is Map ? data : <Object?, Object?>{};
        for (final value in map.values) {
          if (value is List) return value.map(PayslipDto.fromJson).toList();
        }
        return <PayslipDto>[];
      },
    );
  }

  Future<TaskDto> updateTask({
    required String taskId,
    required String status,
    required int version,
  }) {
    return _api.patch<TaskDto>(
      '/api/v1/staff-os/tasks/$taskId',
      body: {'status': status, 'version': version},
      fromData: TaskDto.fromJson,
    );
  }

  Future<List<LeaveDto>> fetchLeaves({int? limit}) {
    final query = <String, String>{};
    if (limit != null) query['limit'] = limit.toString();
    return _api.get<List<LeaveDto>>(
      '/api/v1/staff-os/leaves',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => LeaveDto.fromJson(e)).toList();
      },
    );
  }

  Future<void> applyLeave({
    required String leaveType,
    required String startDate,
    required String endDate,
    required String reason,
  }) {
    return _api.post<void>(
      '/api/v1/staff-os/leaves',
      body: {
        'leaveType': leaveType,
        'startDate': startDate,
        'endDate': endDate,
        'reason': reason,
      },
      fromData: (_) {},
    );
  }
}
