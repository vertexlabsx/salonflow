/// Base class for every error surfaced by the application layer.
///
/// The [codeName] is the machine-readable reason (e.g. `unauthorized`,
/// `validation_failed`) that we can map from the backend `error` field.
class AppException implements Exception {
  const AppException({required String message, String? codeName, Object? cause})
    : _message = message,
      _code = codeName,
      _cause = cause;

  final String _message;
  final String? _code;
  final Object? _cause;

  @override
  String toString() {
    if (_cause != null) {
      return _code != null
          ? '$_message ($_code): $_cause'
          : '$_message: $_cause';
    }
    return _code != null ? '$_message ($_code)' : _message;
  }
}

/// Raised when the backend rejects authentication (401).
class UnauthorizedException extends AppException {
  UnauthorizedException([String? message])
    : super(
        message: message ?? 'Your session has expired. Please sign in again.',
        codeName: 'unauthorized',
      );
}

/// Raised when a request times out or the network is unreachable.
class NetworkException extends AppException {
  NetworkException([String? message])
    : super(
        message:
            message ??
            'No network connection. Check your connection and try again.',
        codeName: 'network',
      );
}

/// Raised when the backend responds with an unexpected/invalid shape.
class InvalidResponseException extends AppException {
  InvalidResponseException([String? message])
    : super(
        message: message ?? 'The server returned an unexpected response.',
        codeName: 'invalid_response',
      );
}

/// Raised for validation errors (422/400) with a human-readable message.
class ValidationException extends AppException {
  ValidationException(String message)
    : super(message: message, codeName: 'validation_failed');
}

/// Raised when the current user lacks permission for an action (403).
class ForbiddenException extends AppException {
  ForbiddenException([String? message])
    : super(
        message: message ?? 'You do not have permission to do this.',
        codeName: 'forbidden',
      );
}
