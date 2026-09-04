import 'package:flutter/material.dart';

import 'app_theme.dart';

/// A [ThemeExtension] exposing the Solastio brand tokens to widgets via
/// `Theme.of(context).extension<SolastioTheme>()`. This lets screens reference
/// semantic colors instead of hardcoding them.
class SolastioTheme extends ThemeExtension<SolastioTheme> {
  const SolastioTheme({
    required this.brandSeed,
    required this.background,
    required this.surface,
    required this.surfaceMuted,
    required this.ink,
    required this.muted,
    required this.line,
    required this.accent,
    required this.accentSoft,
    required this.success,
    required this.warning,
    required this.danger,
    required this.info,
  });

  final Color brandSeed;
  final Color background;
  final Color surface;
  final Color surfaceMuted;
  final Color ink;
  final Color muted;
  final Color line;
  final Color accent;
  final Color accentSoft;
  final Color success;
  final Color warning;
  final Color danger;
  final Color info;

  static const SolastioTheme light = SolastioTheme(
    brandSeed: AppTheme.seed,
    background: AppTheme.background,
    surface: AppTheme.surface,
    surfaceMuted: AppTheme.surfaceMuted,
    ink: AppTheme.ink,
    muted: AppTheme.muted,
    line: AppTheme.line,
    accent: AppTheme.accent,
    accentSoft: AppTheme.accentSoft,
    success: AppTheme.success,
    warning: AppTheme.warning,
    danger: AppTheme.danger,
    info: AppTheme.info,
  );

  /// Convenience accessor for screens.
  static SolastioTheme of(BuildContext context) =>
      Theme.of(context).extension<SolastioTheme>() ?? light;

  @override
  SolastioTheme copyWith({
    Color? brandSeed,
    Color? background,
    Color? surface,
    Color? surfaceMuted,
    Color? ink,
    Color? muted,
    Color? line,
    Color? accent,
    Color? accentSoft,
    Color? success,
    Color? warning,
    Color? danger,
    Color? info,
  }) {
    return SolastioTheme(
      brandSeed: brandSeed ?? this.brandSeed,
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceMuted: surfaceMuted ?? this.surfaceMuted,
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      line: line ?? this.line,
      accent: accent ?? this.accent,
      accentSoft: accentSoft ?? this.accentSoft,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
      info: info ?? this.info,
    );
  }

  @override
  SolastioTheme lerp(covariant SolastioTheme? other, double t) {
    if (other == null) return this;
    return SolastioTheme(
      brandSeed: Color.lerp(brandSeed, other.brandSeed, t)!,
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceMuted: Color.lerp(surfaceMuted, other.surfaceMuted, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      line: Color.lerp(line, other.line, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      info: Color.lerp(info, other.info, t)!,
    );
  }
}
