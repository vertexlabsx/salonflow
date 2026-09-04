import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// The Solastio word-mark used on the login and shell surfaces.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.inverse = false});

  /// When true, renders with light text (for dark bars).
  final bool inverse;

  @override
  Widget build(BuildContext context) {
    return Text(
      'Solastio',
      style: TextStyle(
        color: inverse ? Colors.white : AppTheme.accent,
        fontSize: AppTheme.heading,
      ),
    );
  }
}
