import 'api_client.dart';

class RealtimeRepository {
  RealtimeRepository({required ApiClient api}) : _api = api;

  final ApiClient _api;

  Future<Map<String, Object?>> status() {
    return _api.get<Map<String, Object?>>(
      '/api/v1/realtime/',
      fromData: (data) {
        if (data is Map) {
          return data.map((key, value) => MapEntry(key.toString(), value));
        }
        return <String, Object?>{};
      },
    );
  }
}
