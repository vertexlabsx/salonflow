import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/config/api_config.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/mobile_repository.dart';
import '../../../../core/network/realtime_repository.dart';
import '../../../../core/network/storage_token_provider.dart';
import '../../../../core/network/sync_service.dart';
import '../../../../core/storage/offline_cache.dart';
import '../../../../core/storage/sync_queue.dart';
import '../../../../core/storage/token_storage.dart';
import '../../data/repositories/auth_repository.dart';
import '../../domain/session_controller.dart';

/// App configuration loaded once from the environment.
final appConfigProvider = Provider<AppConfig>(
  (ref) => AppConfig.fromEnvironment(),
);

/// Secure token/session storage.
final tokenStorageProvider = Provider<TokenStorage>((ref) => TokenStorage());

/// Central HTTP client. Reads tokens from secure storage; the session
/// controller wires `onUnauthorizedHandler` once it is created.
final apiClientProvider = Provider<ApiClient>((ref) {
  final config = ref.watch(appConfigProvider);
  final storage = ref.watch(tokenStorageProvider);
  return ApiClient(
    config: config,
    tokenProvider: StorageTokenProvider(storage),
  );
});

final offlineCacheProvider = Provider<OfflineCache>((ref) => OfflineCache());

final syncQueueProvider = Provider<SyncQueue>((ref) {
  return SyncQueue(ref.watch(offlineCacheProvider));
});

final realtimeRepositoryProvider = Provider<RealtimeRepository>((ref) {
  return RealtimeRepository(api: ref.watch(apiClientProvider));
});

final realtimeStatusProvider = FutureProvider.autoDispose<Map<String, Object?>>(
  (ref) {
    return ref.watch(realtimeRepositoryProvider).status();
  },
);

final mobileRepositoryProvider = Provider<MobileRepository>((ref) {
  return MobileRepository(api: ref.watch(apiClientProvider));
});

final pushConfigProvider = FutureProvider.autoDispose<Map<String, Object?>>((
  ref,
) {
  return ref.watch(mobileRepositoryProvider).pushConfig();
});

final syncServiceProvider = Provider<SyncService>((ref) {
  return SyncService(
    api: ref.watch(apiClientProvider),
    queue: ref.watch(syncQueueProvider),
  );
});

final pendingSyncCountProvider = FutureProvider.autoDispose<int>((ref) async {
  return (await ref.watch(syncQueueProvider).pending()).length;
});

/// Auth API repository.
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(api: ref.watch(apiClientProvider));
});

/// Session controller (login / logout / restore / refresh).
final sessionProvider = StateNotifierProvider<SessionController, SessionState>((
  ref,
) {
  final controller = SessionController(
    auth: ref.watch(authRepositoryProvider),
    storage: ref.watch(tokenStorageProvider),
  );
  ref.watch(apiClientProvider).onUnauthorizedHandler = () =>
      controller.handleUnauthorized();
  return controller;
});
