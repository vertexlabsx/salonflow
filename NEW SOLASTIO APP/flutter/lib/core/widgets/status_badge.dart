import 'package:flutter/material.dart';
import '../theme/solastio_theme.dart';

class StatusBadge extends StatelessWidget {
  const StatusBadge({super.key, required this.label, required this.color});
  final String label;
  final Color color;

  factory StatusBadge.fromStatus(BuildContext context, String status) {
    final colors = SolastioTheme.of(context);
    Color c;
    switch (status) {
      case 'confirmed':
      case 'completed':
      case 'approved':
      case 'paid':
      case 'active':
      case 'clocked_in':
        c = colors.success;
        break;
      case 'pending':
      case 'scheduled':
      case 'in_progress':
      case 'draft':
        c = colors.warning;
        break;
      case 'cancelled':
      case 'no_show':
      case 'rejected':
      case 'void':
      case 'expired':
        c = colors.danger;
        break;
      default:
        c = colors.muted;
    }
    return StatusBadge(label: status.replaceAll('_', ' '), color: c);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
