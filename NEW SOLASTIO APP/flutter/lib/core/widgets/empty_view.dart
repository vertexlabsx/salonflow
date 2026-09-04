import 'package:flutter/material.dart';
import '../theme/solastio_theme.dart';

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.message,
    this.icon = Icons.inbox_outlined,
  });
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: colors.muted, size: 48),
          const SizedBox(height: 12),
          Text(message, style: TextStyle(color: colors.muted, fontSize: 14)),
        ],
      ),
    );
  }
}
