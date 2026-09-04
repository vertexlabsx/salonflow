import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';

/// Reads the current access token directly from secure storage for the
/// Authorization header.
class StorageTokenProvider implements TokenProvider {
  StorageTokenProvider(this._storage);
  final TokenStorage _storage;

  @override
  Future<String?> accessToken() => _storage.accessToken();
}
