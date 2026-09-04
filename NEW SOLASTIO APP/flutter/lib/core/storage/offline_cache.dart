import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';

class OfflineCache {
  Future<void> writeJson(String key, Object? value) async {
    final file = await _file(key);
    await file.parent.create(recursive: true);
    await file.writeAsString(jsonEncode(value), flush: true);
  }

  Future<Object?> readJson(String key) async {
    final file = await _file(key);
    if (!await file.exists()) return null;
    final raw = await file.readAsString();
    if (raw.isEmpty) return null;
    return jsonDecode(raw);
  }

  Future<void> remove(String key) async {
    final file = await _file(key);
    if (await file.exists()) await file.delete();
  }

  Future<File> _file(String key) async {
    final dir = await getApplicationSupportDirectory();
    final safeKey = key.replaceAll(RegExp(r'[^a-zA-Z0-9_.-]'), '_');
    return File(path.join(dir.path, 'cache', '$safeKey.json'));
  }
}
