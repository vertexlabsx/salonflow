/// Central application configuration.
///
/// All environment-sensitive values live here so they are never spread
/// across the codebase.
class AppConfig {
  const AppConfig({required this.apiBaseUrl, required this.apiTimeout});

  /// Base URL of the Rust backend API (e.g. http://127.0.0.1:4000).
  final String apiBaseUrl;

  /// Default per-request timeout.
  final Duration apiTimeout;

  factory AppConfig.fromEnvironment({String? override}) {
    const configuredBase = String.fromEnvironment(
      'SOLASTIO_API_BASE',
      defaultValue: 'http://127.0.0.1:4000',
    );
    final base = override ?? configuredBase;
    return AppConfig(apiBaseUrl: base, apiTimeout: const Duration(seconds: 20));
  }
}
