import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/solastio_theme.dart';
import 'providers/owner_providers.dart';

class OwnerFormFieldSpec {
  const OwnerFormFieldSpec({
    required this.key,
    required this.label,
    this.required = true,
    this.keyboardType,
    this.defaultValue,
    this.commaSeparatedList = false,
  });

  final String key;
  final String label;
  final bool required;
  final TextInputType? keyboardType;
  final String? defaultValue;
  final bool commaSeparatedList;
}

class OwnerFormPage extends ConsumerStatefulWidget {
  const OwnerFormPage({
    super.key,
    required this.title,
    required this.fields,
    required this.onSubmit,
    required this.invalidateSection,
    this.initialValues = const {},
  });

  final String title;
  final List<OwnerFormFieldSpec> fields;
  final Future<void> Function(WidgetRef ref, Map<String, Object?> body)
  onSubmit;
  final OwnerSection invalidateSection;
  final Map<String, Object?> initialValues;

  @override
  ConsumerState<OwnerFormPage> createState() => _OwnerFormPageState();
}

class _OwnerFormPageState extends ConsumerState<OwnerFormPage> {
  final _formKey = GlobalKey<FormState>();
  final _values = <String, String>{};
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    for (final field in widget.fields) {
      final initial =
          widget.initialValues[field.key]?.toString() ?? field.defaultValue;
      if (initial != null) _values[field.key] = initial;
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final field in widget.fields) ...[
                TextFormField(
                  initialValue:
                      widget.initialValues[field.key]?.toString() ??
                      field.defaultValue,
                  decoration: InputDecoration(labelText: field.label),
                  keyboardType: field.keyboardType,
                  validator: (value) {
                    if (field.required &&
                        (value == null || value.trim().isEmpty)) {
                      return 'Required';
                    }
                    return null;
                  },
                  onChanged: (value) => _values[field.key] = value,
                ),
                const SizedBox(height: 12),
              ],
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
                    : Text(widget.title),
              ),
              const SizedBox(height: 8),
              Text(
                'Connected to the Rust owner-console API.',
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
    setState(() => _submitting = true);
    try {
      await widget.onSubmit(ref, _coerceValues());
      ref.invalidate(ownerSectionProvider(widget.invalidateSection));
      if (mounted) Navigator.of(context).pop();
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Map<String, Object?> _coerceValues() {
    final body = <String, Object?>{};
    for (final entry in _values.entries) {
      final value = entry.value.trim();
      if (value.isEmpty) continue;
      final spec = widget.fields.where((field) => field.key == entry.key).first;
      if (spec.commaSeparatedList) {
        body[entry.key] = value
            .split(',')
            .map((part) => part.trim())
            .where((part) => part.isNotEmpty)
            .toList();
      } else {
        final intValue = int.tryParse(value);
        final lower = value.toLowerCase();
        final boolValue = lower == 'true'
            ? true
            : lower == 'false'
            ? false
            : null;
        body[entry.key] = intValue ?? boolValue ?? value;
      }
    }
    return body;
  }
}
