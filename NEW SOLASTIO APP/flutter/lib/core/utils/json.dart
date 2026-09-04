/// Defensive helpers for reading backend JSON without unsafe casts.
///
/// The Rust `{ ok, data }` envelope and model fields are plain maps; these
/// helpers degrade to safe defaults instead of throwing on shape drift.
abstract final class Json {
  static Map<String, Object?> asMap(Object? value) {
    if (value is Map) {
      final result = <String, Object?>{};
      for (final entry in value.entries) {
        result[entry.key.toString()] = entry.value;
      }
      return result;
    }
    return <String, Object?>{};
  }

  static List<Object?> asList(Object? value) {
    if (value is List) return List<Object?>.from(value);
    return <Object?>[];
  }

  static String? string(Object? value) {
    if (value is String) return value;
    return null;
  }

  static int? integer(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return null;
  }

  static double? number(Object? value) {
    if (value is num) return value.toDouble();
    return null;
  }

  static bool? boolean(Object? value) {
    if (value is bool) return value;
    return null;
  }

  static List<String> stringList(Object? value) {
    if (value is List) return value.whereType<String>().toList();
    return const [];
  }

  static List<Object?> list(Object? value) => asList(value);

  static int? intNum(Object? value) => integer(value);

  static bool? boolVal(Object? value) => boolean(value);
}
