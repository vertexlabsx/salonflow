import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'providers/auth_providers.dart';

/// Route guard that enforces the authentication boundary:
///  - a signed-in user going to `/login` is redirected to `/staff`
///  - a signed-out user going anywhere but `/login` is redirected to `/login`
///
/// It is installed as `GoRouter.onEnter` in [SolastioApp].
OnEnterResult authGuard(
  BuildContext context,
  GoRouterState currentState,
  GoRouterState nextState,
  GoRouter goRouter,
) {
  final container = ProviderScope.containerOf(context, listen: false);
  final session = container.read(sessionProvider);

  final path = nextState.uri.path;
  final signedIn = session.isSignedIn;

  if (signedIn && path == '/login') {
    return Block.then(() => goRouter.go('/staff'));
  }
  if (!signedIn && path != '/login') {
    return Block.then(() => goRouter.go('/login'));
  }
  return Allow();
}
