import 'package:dio/dio.dart';
import 'package:logger/logger.dart';

import '../config/api_config.dart';
import '../errors/app_exception.dart';

/// Supplies the Bearer token for a request, or null when signed out.
abstract interface class TokenProvider {
  Future<String?> accessToken();
}

/// Central HTTP layer on top of a Dio [Dio] client.
///
/// Responsibilities:
///  - attaches `Authorization: Bearer <token>` per request
///  - applies a timeout via [AppConfig.apiTimeout]
///  - logs requests in development
///  - unwraps the Rust `{ ok, data }` envelope into a typed T
///  - maps HTTP/Dio errors onto the app exception hierarchy
///
/// No screen ever performs raw HTTP; everything routes through here.
class ApiClient {
  final Dio _dio;
  final TokenProvider _tokenProvider;
  final Logger _log;

  /// Assigned by the session layer to react to 401 responses (refresh / sign
  /// out). Kept as a field instead of a constructor hook to avoid a circular
  /// dependency between the HTTP client and the session controller.
  Future<void> Function()? onUnauthorizedHandler;

  ApiClient({
    required AppConfig config,
    required TokenProvider tokenProvider,
    Dio? dio,
  }) : _tokenProvider = tokenProvider,
       _log = Logger(level: Level.info),
       _dio =
           dio ??
           Dio(
             BaseOptions(
               baseUrl: config.apiBaseUrl,
               receiveTimeout: config.apiTimeout,
             ),
           );

  Future<T> get<T>(
    String path, {
    T Function(Object? data)? fromData,
    Map<String, String>? query,
  }) async {
    return _run(
      'GET',
      path: path,
      query: query,
      fromData: fromData ?? (data) => data as T,
    );
  }

  Future<T> post<T>(
    String path, {
    required T Function(Object? data) fromData,
    Object? body,
  }) async {
    return _run('POST', path: path, body: body, fromData: fromData);
  }

  Future<T> patch<T>(
    String path, {
    required T Function(Object? data) fromData,
    Object? body,
  }) async {
    return _run('PATCH', path: path, body: body, fromData: fromData);
  }

  Future<T> put<T>(
    String path, {
    required T Function(Object? data) fromData,
    Object? body,
  }) async {
    return _run('PUT', path: path, body: body, fromData: fromData);
  }

  Future<T> callDelete<T>(
    String path, {
    T Function(Object? data)? fromData,
  }) async {
    return _run(
      'DELETE',
      path: path,
      fromData: fromData ?? (data) => data as T,
    );
  }

  Future<T> _run<T>(
    String method, {
    required String path,
    Object? body,
    Map<String, String>? query,
    required T Function(Object? data) fromData,
  }) async {
    final token = await _tokenProvider.accessToken();
    final headers = <String, dynamic>{
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
    final options = Options(method: method, headers: headers);

    _log.i('$method $path');

    Response<Object?> response;
    try {
      response = await _dio.request<T>(
        path,
        data: body,
        queryParameters: query,
        options: options,
      );
    } on DioException catch (e) {
      throw _fromDioException(e);
    }

    final status = response.statusCode ?? -1;
    if (status == 401) {
      await onUnauthorizedHandler?.call();
      throw UnauthorizedException();
    }
    if (status == 403) {
      throw ForbiddenException();
    }
    if (status < 200 || status >= 300) {
      throw _errorFromBody(response.data);
    }

    return fromData(_dataFromBody(response.data));
  }

  AppException _fromDioException(DioException e) {
    switch (e.type) {
      case DioExceptionType.badResponse:
        return AppException(
          message: 'The server returned an invalid response.',
        );
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.connectionError:
      case DioExceptionType.badCertificate:
        return NetworkException();
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return NetworkException('Request timed out.');
      case DioExceptionType.cancel:
        return AppException(message: 'Request was cancelled.');
      default:
        return NetworkException('Could not reach the server.');
    }
  }

  /// Maps non-2xx JSON bodies onto typed errors.
  AppException _errorFromBody(Object? data) {
    if (data is Map<Object?, Object?>) {
      final map = data;
      final reason = map['error'] ?? map['code'];
      final message = map['message'];
      if (message != null) {
        return ValidationException(message.toString());
      }
      if (reason != null) {
        return AppException(
          message: 'Request failed ($reason).',
          codeName: reason.toString(),
        );
      }
    }
    return NetworkException('The server could not complete the request.');
  }

  /// Extracts `data` from the Rust envelope when present.
  Object? _dataFromBody(Object? data) {
    if (data is Map<Object?, Object?> && (data).containsKey('data')) {
      return (data)['data'];
    }
    return data;
  }
}
