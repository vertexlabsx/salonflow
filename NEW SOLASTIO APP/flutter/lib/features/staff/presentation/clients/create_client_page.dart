import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../auth/presentation/providers/auth_providers.dart';
import '../providers/providers.dart';

class CreateClientPage extends ConsumerStatefulWidget {
  const CreateClientPage({super.key});

  @override
  ConsumerState<CreateClientPage> createState() => _CreateClientPageState();
}

class _CreateClientPageState extends ConsumerState<CreateClientPage> {
  final _formKey = GlobalKey<FormState>();
  String _name = '';
  String _phone = '';
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('New Client')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                decoration: const InputDecoration(labelText: 'Name'),
                validator: (value) =>
                    value == null || value.trim().isEmpty ? 'Required' : null,
                onChanged: (value) => _name = value,
              ),
              const SizedBox(height: 12),
              TextFormField(
                decoration: const InputDecoration(labelText: 'Phone'),
                keyboardType: TextInputType.phone,
                validator: (value) =>
                    value == null || value.trim().isEmpty ? 'Required' : null,
                onChanged: (value) => _phone = value,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _submitting ? null : _submit,
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Create Client'),
              ),
              const SizedBox(height: 8),
              Text(
                'Creates through /api/v1/catalog/customers.',
                style: TextStyle(color: colors.muted, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final branchId = ref.read(sessionProvider).user?.branchId;
    if (branchId == null || branchId.isEmpty) return;
    setState(() => _submitting = true);
    try {
      await ref
          .read(catalogRepositoryProvider)
          .createClient(
            branchId: branchId,
            name: _name.trim(),
            phone: _phone.trim(),
          );
      ref.invalidate(clientSearchProvider(''));
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
