import 'package:flutter/material.dart';
import '../theme/solastio_theme.dart';

class LoadingIndicator extends StatelessWidget {
  const LoadingIndicator({super.key, this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: colors.accent),
          if (message != null) ...[
            const SizedBox(height: 12),
            Text(message!, style: TextStyle(color: colors.muted, fontSize: 14)),
          ],
        ],
      ),
    );
  }
}
