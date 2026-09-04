import 'package:flutter_test/flutter_test.dart';
import 'package:solastio_staff/features/staff/data/models/appointment_dto.dart';
import 'package:solastio_staff/features/staff/data/models/attendance_dto.dart';
import 'package:solastio_staff/features/staff/data/models/client_dto.dart';
import 'package:solastio_staff/features/staff/data/models/staff_today_dto.dart';
import 'package:solastio_staff/features/staff/data/models/task_dto.dart';

void main() {
  test('AppointmentDto round-trips through cache JSON', () {
    final original = AppointmentDto.fromJson({
      'id': 'a1',
      'branchId': 'b1',
      'staffId': 's1',
      'customerName': 'Anika',
      'serviceIds': ['svc1'],
      'serviceNames': ['Haircut'],
      'durationMinutes': 45,
      'value': 150000,
      'startAt': '2026-09-04T10:00:00Z',
      'status': 'confirmed',
      'source': 'staff-app',
      'version': 3,
    });

    final restored = AppointmentDto.fromJson(original.toJson());

    expect(restored.id, original.id);
    expect(restored.customerName, 'Anika');
    expect(restored.serviceNames, ['Haircut']);
    expect(restored.version, 3);
  });

  test('StaffTodayResponse round-trips nested dashboard data', () {
    final today = StaffTodayResponse(
      date: '2026-09-04',
      attendance: const [
        AttendanceDto(
          id: 'att1',
          staffId: 's1',
          businessDate: '2026-09-04',
          clockInAt: '2026-09-04T09:00:00Z',
          status: 'clocked_in',
          source: 'staff-app',
          grossMinutes: 60,
        ),
      ],
      tasks: const [
        TaskDto(id: 't1', title: 'Prep room', status: 'pending', version: 1),
      ],
    );

    final restored = StaffTodayResponse.fromJson(today.toJson());

    expect(restored.date, today.date);
    expect(restored.attendance.first.id, 'att1');
    expect(restored.tasks.first.title, 'Prep room');
  });

  test('ClientDto round-trips optional fields', () {
    final client = ClientDto.fromJson({
      'id': 'c1',
      'name': 'Rhea',
      'phone': '9999999999',
      'tags': ['vip'],
    });

    final restored = ClientDto.fromJson(client.toJson());

    expect(restored.name, 'Rhea');
    expect(restored.tags, ['vip']);
  });
}
