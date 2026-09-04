/// Global domain constants.
abstract final class AppConstants {
  static const String appName = 'Solastio Staff';
  static const String storageKeyAccessToken = 'solastio.access_token';
  static const String storageKeyRefreshToken = 'solastio.refresh_token';
  static const String storageKeySessionUser = 'solastio.session_user';

  /// Responsive breakpoints (in logical pixels).
  static const double mobileMax = 600;
  static const double tabletMax = 1024;

  /// Default page size for list endpoints that support pagination.
  static const int defaultPageSize = 50;
}
