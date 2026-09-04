import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/brand_mark.dart';
import '../../domain/session_controller.dart';
import '../providers/auth_providers.dart';

/// Sign-in screen. Captures tenant + credentials and drives
/// [SessionController.login]; auto-navigates to `/staff` on success and
/// shows a friendly error otherwise.
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  LoginPageState createState() => LoginPageState();
}

class LoginPageState extends ConsumerState<LoginPage> {
  String _tenant = '';
  String _loginId = '';
  String _password = '';

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);

    // React to a successful login by advancing to the staff area. `ref.listen`
    // keeps this out of the build body to avoid modifying providers mid-build.
    ref.listen<SessionState>(sessionProvider, (prev, next) {
      if (next.isSignedIn && context.mounted) {
        context.go('/staff');
      }
    });

    final error = session.status == SessionStatus.signInFailed
        ? _describe(session.error)
        : null;
    final canSubmit =
        !session.isSigningIn &&
        _tenant.trim().isNotEmpty &&
        _loginId.trim().isNotEmpty;

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const BrandMark(),
              const SizedBox(height: 8),
              Text(
                'Staff sign in',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: 320,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      decoration: const InputDecoration(labelText: 'Tenant ID'),
                      onChanged: (value) => setState(() => _tenant = value),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      decoration: const InputDecoration(labelText: 'Login ID'),
                      onChanged: (value) => setState(() => _loginId = value),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      decoration: const InputDecoration(labelText: 'Password'),
                      obscureText: true,
                      onChanged: (value) => setState(() => _password = value),
                      onSubmitted: (_) {
                        if (canSubmit) _submit();
                      },
                    ),
                  ],
                ),
              ),
              if (error != null) ...[
                const SizedBox(height: 4),
                Text(
                  error,
                  style: TextStyle(
                    color: SolastioTheme.of(context).danger,
                    fontSize: 13,
                  ),
                ),
              ],
              SizedBox(height: error == null ? 8 : 4),
              FilledButton(
                onPressed: canSubmit ? _submit : null,
                child: Text(session.isSigningIn ? 'Signing in…' : 'Sign in'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _submit() {
    if (_tenant.trim().isEmpty || _loginId.trim().isEmpty) return;
    final controller = ref.read(sessionProvider.notifier);
    controller.login(
      tenantId: _tenant.trim(),
      loginId: _loginId.trim(),
      password: _password,
    );
  }

  String _describe(Object? error) {
    if (error is String && error.isNotEmpty) return error;
    return 'Could not sign in. Check your details and try again.';
  }
}
