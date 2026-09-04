// Basic smoke test for the auth login vertical slice.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:solastio_staff/features/auth/presentation/login/login_page.dart';

void main() {
  testWidgets('Login page renders the brand and sign-in heading', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(child: const MaterialApp(home: LoginPage())),
    );

    expect(find.text('Solastio'), findsOneWidget);
    expect(find.text('Staff sign in'), findsOneWidget);
  });
}
