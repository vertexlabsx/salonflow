/// Mirrors the Rust `{ ok, data, ... }` success envelope.
class ApiResponse {
  const ApiResponse({required this.ok, this.data});

  final bool ok;
  final Object? data;
}
