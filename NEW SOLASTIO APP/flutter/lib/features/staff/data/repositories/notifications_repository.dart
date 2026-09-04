import '../../../../core/network/api_client.dart';
import '../models/notification_dto.dart';

class NotificationsRepository {
  final ApiClient _api;
  NotificationsRepository({required ApiClient api}) : _api = api;

  Future<List<NotificationDto>> fetchNotifications({int? limit}) {
    return _api.get<List<NotificationDto>>(
      '/api/v1/mobile/notifications',
      query: {if (limit != null) 'limit': limit.toString()},
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => NotificationDto.fromJson(e)).toList();
      },
    );
  }

  Future<void> markRead({required String notificationId}) {
    return _api.patch<void>(
      '/api/v1/mobile/notifications/$notificationId',
      body: {'status': 'read'},
      fromData: (_) {},
    );
  }
}
