import 'package:flutter/painting.dart';

/// Central design tokens for the application.
///
/// Every screen should pull values from [AppTheme]; do not hardcode colors,
/// spacing or radii inside widgets.
class AppTheme {
  const AppTheme();

  // ---- Brand palette -----------------------------------------------------
  static const Color seed = Color(0xff3E2A1B);
  static const Color background = Color(0xffFBF8F3);
  static const Color surface = Color(0xffFFFFFF);
  static const Color surfaceMuted = Color(0xffF4EFE8);
  static const Color ink = Color(0xff24201B);
  static const Color muted = Color(0xff7A7166);
  static const Color line = Color(0xffE8E1D7);
  static const Color accent = Color(0xff8A6D3B);
  static const Color accentSoft = Color(0xffEADFCC);
  static const Color success = Color(0xff2F8F4E);
  static const Color warning = Color(0xffC98A2E);
  static const Color danger = Color(0xffC0392B);
  static const Color info = Color(0xff3E6EB0);

  // ---- Typography --------------------------------------------------------
  static const String fontFamily = 'Segoe UI, Roboto, sans-serif';
  static const double heading = 22;
  static const double subheading = 17;
  static const double body = 14;
  static const double label = 12;

  // ---- Spacing / radius / elevation -------------------------------------
  static const double space = 8;
  static const double radius = 14;
  static const double radiusSmall = 9;
}
