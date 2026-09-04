import 'package:flutter/material.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../data/models/client_dto.dart';

class ClientDetailPage extends StatelessWidget {
  const ClientDetailPage({super.key, required this.client});
  final ClientDto client;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(client.name)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: CircleAvatar(
                radius: 40,
                backgroundColor: colors.accentSoft,
                child: Text(
                  client.name.isNotEmpty ? client.name[0].toUpperCase() : '?',
                  style: TextStyle(
                    color: colors.accent,
                    fontSize: 28,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Center(
              child: Text(
                client.name,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                  color: colors.ink,
                ),
              ),
            ),
            const SizedBox(height: 24),
            _Row(label: 'Phone', value: client.phone ?? '—'),
            _Row(label: 'Email', value: client.email ?? '—'),
            _Row(label: 'Gender', value: client.gender ?? '—'),
            _Row(label: 'Birthday', value: client.birthday ?? '—'),
            _Row(label: 'Address', value: client.address ?? '—'),
            if (client.tags.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text('Tags', style: TextStyle(color: colors.muted, fontSize: 13)),
              const SizedBox(height: 4),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: client.tags
                    .map(
                      (t) => Chip(
                        label: Text(t, style: TextStyle(fontSize: 12)),
                        backgroundColor: colors.accentSoft,
                        labelStyle: TextStyle(color: colors.accent),
                      ),
                    )
                    .toList(),
              ),
            ],
            if (client.notes != null && client.notes!.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text(
                'Notes',
                style: TextStyle(color: colors.muted, fontSize: 13),
              ),
              const SizedBox(height: 4),
              Text(
                client.notes!,
                style: TextStyle(color: colors.ink, fontSize: 14),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: TextStyle(color: colors.muted, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(color: colors.ink, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}
