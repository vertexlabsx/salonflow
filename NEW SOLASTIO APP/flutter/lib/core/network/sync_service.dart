import '../storage/sync_queue.dart';
import 'api_client.dart';

class SyncService {
  SyncService({required ApiClient api, required SyncQueue queue})
    : _api = api,
      _queue = queue;

  final ApiClient _api;
  final SyncQueue _queue;

  Future<int> flush() async {
    final writes = await _queue.pending();
    final remaining = <QueuedWrite>[];
    var synced = 0;

    for (final write in writes) {
      try {
        await _send(write);
        synced++;
      } catch (_) {
        remaining.add(write);
      }
    }

    await _queue.replace(remaining);
    return synced;
  }

  Future<void> _send(QueuedWrite write) {
    switch (write.method.toUpperCase()) {
      case 'POST':
        return _api.post<void>(write.path, body: write.body, fromData: (_) {});
      case 'PATCH':
        return _api.patch<void>(write.path, body: write.body, fromData: (_) {});
      case 'PUT':
        return _api.put<void>(write.path, body: write.body, fromData: (_) {});
      case 'DELETE':
        return _api.callDelete<void>(write.path, fromData: (_) {});
      default:
        return Future.value();
    }
  }
}
