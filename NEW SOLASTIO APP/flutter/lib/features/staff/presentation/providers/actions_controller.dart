import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/storage/sync_queue.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../../data/repositories/staff_os_repository.dart';
import '../../data/repositories/appointments_repository.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/notifications_repository.dart';
import 'providers.dart';

class ActionsController {
  final StaffOsRepository _staffOs;
  final AppointmentsRepository _appointments;
  final ChatRepository _chat;
  final NotificationsRepository _notifications;
  final SyncQueue _syncQueue;

  ActionsController({
    required StaffOsRepository staffOs,
    required AppointmentsRepository appointments,
    required ChatRepository chat,
    required NotificationsRepository notifications,
    required SyncQueue syncQueue,
  }) : _staffOs = staffOs,
       _appointments = appointments,
       _chat = chat,
       _notifications = notifications,
       _syncQueue = syncQueue;

  Future<void> clockIn() => _queueable(
    method: 'POST',
    path: '/api/v1/staff-os/attendance/clock-in',
    body: {'source': 'staff-app'},
    action: () => _staffOs.clockIn().then((_) {}),
  );

  Future<void> clockOut(String attendanceId) => _queueable(
    method: 'POST',
    path: '/api/v1/staff-os/attendance/clock-out',
    body: {'attendanceId': attendanceId},
    action: () => _staffOs.clockOut(attendanceId: attendanceId).then((_) {}),
  );

  Future<void> startBreak() => _queueable(
    method: 'POST',
    path: '/api/v1/staff-os/attendance/break-start',
    body: {'breakType': 'regular'},
    action: () => _staffOs.startBreak().then((_) {}),
  );

  Future<void> endBreak(String breakId) => _queueable(
    method: 'POST',
    path: '/api/v1/staff-os/attendance/break-end',
    body: {'breakId': breakId},
    action: () => _staffOs.endBreak(breakId: breakId),
  );

  Future<void> updateTask(String taskId, String status, int version) =>
      _queueable(
        method: 'PATCH',
        path: '/api/v1/staff-os/tasks/$taskId',
        body: {'status': status, 'version': version},
        action: () => _staffOs
            .updateTask(taskId: taskId, status: status, version: version)
            .then((_) {}),
      );

  Future<void> updateAppointmentStatus(String id, String status, int version) =>
      _queueable(
        method: 'PATCH',
        path: '/api/v1/appointments/$id/status',
        body: {'status': status, 'version': version},
        action: () => _appointments
            .updateStatus(id: id, status: status, version: version)
            .then((_) {}),
      );

  Future<void> sendMessage(String conversationId, String body) => _queueable(
    method: 'POST',
    path: '/api/v1/team-chat/conversations/$conversationId/messages',
    body: {'body': body},
    action: () => _chat
        .sendMessage(conversationId: conversationId, body: body)
        .then((_) {}),
  );

  Future<void> markNotificationRead(String id) => _queueable(
    method: 'PATCH',
    path: '/api/v1/mobile/notifications/$id',
    body: {'status': 'read'},
    action: () => _notifications.markRead(notificationId: id),
  );

  Future<void> markChatRead(String conversationId, List<String> messageIds) =>
      _queueable(
        method: 'POST',
        path: '/api/v1/team-chat/conversations/$conversationId/receipts',
        body: {'messageIds': messageIds, 'status': 'read'},
        action: () => _chat.markRead(
          conversationId: conversationId,
          messageIds: messageIds,
        ),
      );

  Future<void> _queueable({
    required String method,
    required String path,
    required Object? body,
    required Future<void> Function() action,
  }) async {
    try {
      await action();
    } catch (_) {
      await _syncQueue.enqueue(method: method, path: path, body: body);
    }
  }
}

final actionsControllerProvider = Provider<ActionsController>((ref) {
  return ActionsController(
    staffOs: ref.watch(staffOsRepositoryProvider),
    appointments: ref.watch(appointmentsRepositoryProvider),
    chat: ref.watch(chatRepositoryProvider),
    notifications: ref.watch(notificationsRepositoryProvider),
    syncQueue: ref.watch(syncQueueProvider),
  );
});
