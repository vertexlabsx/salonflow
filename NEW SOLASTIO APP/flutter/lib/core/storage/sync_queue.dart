import 'dart:convert';

import 'offline_cache.dart';

class QueuedWrite {
  const QueuedWrite({
    required this.id,
    required this.method,
    required this.path,
    required this.body,
    required this.createdAt,
  });

  final String id;
  final String method;
  final String path;
  final Object? body;
  final DateTime createdAt;

  Map<String, Object?> toJson() => {
    'id': id,
    'method': method,
    'path': path,
    'body': body,
    'createdAt': createdAt.toIso8601String(),
  };

  factory QueuedWrite.fromJson(Object? json) {
    final map = json is Map ? json : <Object?, Object?>{};
    return QueuedWrite(
      id: '${map['id'] ?? ''}',
      method: '${map['method'] ?? 'POST'}',
      path: '${map['path'] ?? ''}',
      body: map['body'],
      createdAt:
          DateTime.tryParse('${map['createdAt'] ?? ''}') ?? DateTime.now(),
    );
  }
}

class SyncQueue {
  SyncQueue(this._cache);

  final OfflineCache _cache;
  static const _key = 'sync_queue';

  Future<List<QueuedWrite>> pending() async {
    final raw = await _cache.readJson(_key);
    if (raw is! List) return <QueuedWrite>[];
    return raw
        .map(QueuedWrite.fromJson)
        .where((write) => write.path.isNotEmpty)
        .toList();
  }

  Future<void> enqueue({
    required String method,
    required String path,
    Object? body,
  }) async {
    final writes = await pending();
    writes.add(
      QueuedWrite(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        method: method,
        path: path,
        body: body,
        createdAt: DateTime.now(),
      ),
    );
    await _cache.writeJson(
      _key,
      writes.map((write) => write.toJson()).toList(),
    );
  }

  Future<void> replace(List<QueuedWrite> writes) async {
    await _cache.writeJson(
      _key,
      jsonDecode(jsonEncode(writes.map((write) => write.toJson()).toList())),
    );
  }

  Future<void> clear() async => _cache.remove(_key);
}
