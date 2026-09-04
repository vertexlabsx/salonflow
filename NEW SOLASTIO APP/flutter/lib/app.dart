import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/theme/app_theme.dart';
import 'core/theme/solastio_theme.dart';
import 'features/auth/presentation/providers/auth_providers.dart';
import 'features/auth/presentation/router_guard.dart';
import 'features/auth/presentation/login/login_page.dart';
import 'features/staff/presentation/staff_shell.dart';

/// Root widget. Owns the app theme, routing table and the auth guard.
class SolastioApp extends ConsumerStatefulWidget {
  const SolastioApp({super.key});

  @override
  SolastioAppState createState() => SolastioAppState();
}

class SolastioAppState extends ConsumerState<SolastioApp> {
  @override
  void initState() {
    super.initState();
    // Restore any persisted session after the first frame so providers can be
    // modified outside the build lifecycle (see flutter_riverpod docs).
    Future(() => ref.read(sessionProvider.notifier).restore());
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'Solastio Staff',
      theme: _buildTheme(),
      routerConfig: _router(guard: authGuard),
    );
  }
}

ThemeData _buildTheme() {
  return ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: AppTheme.seed),
    scaffoldBackgroundColor: AppTheme.background,
    fontFamily: AppTheme.fontFamily,
    extensions: [SolastioTheme.light],
  );
}

/// The top-level routing table.
///
/// `/` redirects to `/login`; every navigation passes through [authGuard].
GoRouter _router({required OnEnter guard}) {
  return GoRouter(
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        redirect: (BuildContext context, GoRouterState state) => '/login',
      ),
      GoRoute(
        path: '/login',
        builder: (BuildContext context, GoRouterState state) =>
            const LoginPage(),
      ),
      GoRoute(
        path: '/staff',
        builder: (BuildContext context, GoRouterState state) =>
            const StaffShell(),
      ),
    ],
    onEnter: guard,
  );
}
