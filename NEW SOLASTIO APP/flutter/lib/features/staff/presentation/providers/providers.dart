import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/repositories/staff_os_repository.dart';
import '../../data/repositories/roster_repository.dart';
import '../../data/repositories/appointments_repository.dart';
import '../../data/repositories/catalog_repository.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/notifications_repository.dart';
import '../../data/repositories/payroll_repository.dart';
import '../../data/models/appointment_dto.dart';
import '../../data/models/attendance_dto.dart';
import '../../data/models/client_dto.dart';
import '../../data/models/conversation_dto.dart';
import '../../data/models/leave_dto.dart';
import '../../data/models/notification_dto.dart';
import '../../data/models/payslip_dto.dart';
import '../../data/models/schedule_dto.dart';
import '../../data/models/service_dto.dart';
import '../../data/models/staff_today_dto.dart';
import '../../data/models/task_dto.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

// ---- Repositories ----

final staffOsRepositoryProvider = Provider<StaffOsRepository>((ref) {
  return StaffOsRepository(api: ref.watch(apiClientProvider));
});

final rosterRepositoryProvider = Provider<RosterRepository>((ref) {
  return RosterRepository(api: ref.watch(apiClientProvider));
});

final appointmentsRepositoryProvider = Provider<AppointmentsRepository>((ref) {
  return AppointmentsRepository(api: ref.watch(apiClientProvider));
});

final catalogRepositoryProvider = Provider<CatalogRepository>((ref) {
  return CatalogRepository(api: ref.watch(apiClientProvider));
});

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository(api: ref.watch(apiClientProvider));
});

final notificationsRepositoryProvider = Provider<NotificationsRepository>((
  ref,
) {
  return NotificationsRepository(api: ref.watch(apiClientProvider));
});

final payrollRepositoryProvider = Provider<PayrollRepository>((ref) {
  return PayrollRepository(api: ref.watch(apiClientProvider));
});

// ---- Today / Dashboard ----

final todayProvider = FutureProvider.autoDispose<dynamic>((ref) async {
  final repo = ref.watch(staffOsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchToday();
    await cache.writeJson('staff_today', data.toJson());
    return data;
  } catch (_) {
    final cached = await cache.readJson('staff_today');
    if (cached != null) return StaffTodayResponse.fromJson(cached);
    rethrow;
  }
});

// ---- Appointments ----

final appointmentsProvider = FutureProvider.autoDispose<List<dynamic>>((
  ref,
) async {
  final repo = ref.watch(appointmentsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchAppointments(limit: 50);
    await cache.writeJson('appointments', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('appointments');
    if (cached is List) return cached.map(AppointmentDto.fromJson).toList();
    rethrow;
  }
});

// ---- Attendance ----

final attendanceProvider = FutureProvider.autoDispose<List<dynamic>>((
  ref,
) async {
  final repo = ref.watch(staffOsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchAttendance(limit: 30);
    await cache.writeJson('attendance', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('attendance');
    if (cached is List) return cached.map(AttendanceDto.fromJson).toList();
    rethrow;
  }
});

// ---- Tasks ----

final tasksProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final repo = ref.watch(staffOsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchTasks(limit: 50);
    await cache.writeJson('tasks', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('tasks');
    if (cached is List) return cached.map(TaskDto.fromJson).toList();
    rethrow;
  }
});

// ---- Roster / Schedules ----

final rosterProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final repo = ref.watch(rosterRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchSchedules();
    await cache.writeJson('roster', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('roster');
    if (cached is List) return cached.map(ScheduleDto.fromJson).toList();
    rethrow;
  }
});

// ---- Leaves ----

final leavesProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final repo = ref.watch(staffOsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchLeaves(limit: 20);
    await cache.writeJson('leaves', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('leaves');
    if (cached is List) return cached.map(LeaveDto.fromJson).toList();
    rethrow;
  }
});

// ---- Payroll ----

final payrollProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final repo = ref.watch(payrollRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchPayslips(limit: 20);
    await cache.writeJson('payroll', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('payroll');
    if (cached is List) return cached.map(PayslipDto.fromJson).toList();
    rethrow;
  }
});

// ---- Clients (search) ----

final clientSearchProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, query) async {
      final repo = ref.watch(catalogRepositoryProvider);
      final cache = ref.watch(offlineCacheProvider);
      final key = 'clients_${query.isEmpty ? 'all' : query}';
      try {
        final data = await repo.searchClients(q: query.isEmpty ? null : query);
        await cache.writeJson(key, data.map((e) => e.toJson()).toList());
        return data;
      } catch (_) {
        final cached = await cache.readJson(key);
        if (cached is List) return cached.map(ClientDto.fromJson).toList();
        rethrow;
      }
    });

// ---- Chat ----

final conversationsProvider = FutureProvider.autoDispose<List<dynamic>>((
  ref,
) async {
  final repo = ref.watch(chatRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchConversations();
    await cache.writeJson(
      'conversations',
      data.map((e) => e.toJson()).toList(),
    );
    return data;
  } catch (_) {
    final cached = await cache.readJson('conversations');
    if (cached is List) return cached.map(ConversationDto.fromJson).toList();
    rethrow;
  }
});

final messagesProvider = FutureProvider.autoDispose
    .family<List<dynamic>, String>((ref, conversationId) async {
      final repo = ref.watch(chatRepositoryProvider);
      final cache = ref.watch(offlineCacheProvider);
      final key = 'messages_$conversationId';
      try {
        final data = await repo.fetchMessages(conversationId);
        await cache.writeJson(key, data.map((e) => e.toJson()).toList());
        return data;
      } catch (_) {
        final cached = await cache.readJson(key);
        if (cached is List) return cached.map(ChatMessageDto.fromJson).toList();
        rethrow;
      }
    });

// ---- Notifications ----

final notificationsProvider = FutureProvider.autoDispose<List<dynamic>>((
  ref,
) async {
  final repo = ref.watch(notificationsRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchNotifications(limit: 50);
    await cache.writeJson(
      'notifications',
      data.map((e) => e.toJson()).toList(),
    );
    return data;
  } catch (_) {
    final cached = await cache.readJson('notifications');
    if (cached is List) return cached.map(NotificationDto.fromJson).toList();
    rethrow;
  }
});

// ---- Services (for appointment creation) ----

final servicesProvider = FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final repo = ref.watch(catalogRepositoryProvider);
  final cache = ref.watch(offlineCacheProvider);
  try {
    final data = await repo.fetchServices();
    await cache.writeJson('services', data.map((e) => e.toJson()).toList());
    return data;
  } catch (_) {
    final cached = await cache.readJson('services');
    if (cached is List) return cached.map(ServiceDto.fromJson).toList();
    rethrow;
  }
});
