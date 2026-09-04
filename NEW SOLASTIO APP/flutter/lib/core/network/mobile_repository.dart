import 'api_client.dart';

class MobileRepository {
  MobileRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<Map<String, Object?>> pushConfig() {
    return _api.get<Map<String, Object?>>(
      '/api/v1/mobile/push-config',
      fromData: _map,
    );
  }

  Future<void> registerDevice({
    required String platform,
    required String token,
  }) {
    return _api.post<void>(
      '/api/v1/mobile/devices',
      body: {'platform': platform, 'token': token},
      fromData: (_) {},
    );
  }

  Future<void> registerPushSubscription(Map<String, Object?> subscription) {
    return _api.post<void>(
      '/api/v1/mobile/push-subscriptions',
      body: subscription,
      fromData: (_) {},
    );
  }

  Map<String, Object?> _map(Object? data) {
    if (data is Map) {
      return data.map((key, value) => MapEntry(key.toString(), value));
    }
    return <String, Object?>{};
  }
}
