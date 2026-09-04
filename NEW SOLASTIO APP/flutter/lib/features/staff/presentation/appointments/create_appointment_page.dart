import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../providers/providers.dart';
import '../../data/models/service_dto.dart';

class CreateAppointmentPage extends ConsumerStatefulWidget {
  const CreateAppointmentPage({super.key});

  @override
  ConsumerState<CreateAppointmentPage> createState() =>
      _CreateAppointmentPageState();
}

class _CreateAppointmentPageState extends ConsumerState<CreateAppointmentPage> {
  final _formKey = GlobalKey<FormState>();
  String _customerName = '';
  String _phone = '';
  String? _selectedServiceId;
  DateTime _selectedDate = DateTime.now();
  TimeOfDay _selectedTime = TimeOfDay.now();
  bool _submitting = false;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final servicesAsync = ref.watch(servicesProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('New Appointment')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                decoration: const InputDecoration(labelText: 'Customer Name'),
                validator: (v) =>
                    (v == null || v.trim().isEmpty) ? 'Required' : null,
                onChanged: (v) => _customerName = v,
              ),
              const SizedBox(height: 12),
              TextFormField(
                decoration: const InputDecoration(
                  labelText: 'Phone (optional)',
                ),
                keyboardType: TextInputType.phone,
                onChanged: (v) => _phone = v,
              ),
              const SizedBox(height: 12),
              servicesAsync.when(
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => Text(
                  'Failed to load services',
                  style: TextStyle(color: colors.danger),
                ),
                data: (items) {
                  final services = items as List<ServiceDto>;
                  return DropdownButtonFormField<String>(
                    initialValue: _selectedServiceId,
                    decoration: const InputDecoration(labelText: 'Service'),
                    items: services
                        .map(
                          (s) => DropdownMenuItem(
                            value: s.id,
                            child: Text('${s.name} (${s.priceFormatted})'),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => _selectedServiceId = v),
                    validator: (v) => v == null ? 'Select a service' : null,
                  );
                },
              ),
              const SizedBox(height: 12),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('Date & Time'),
                subtitle: Text(
                  '${_selectedDate.toLocal().toString().split(' ')[0]} at ${_selectedTime.format(context)}',
                ),
                trailing: const Icon(Icons.calendar_today),
                onTap: () async {
                  final date = await showDatePicker(
                    context: context,
                    initialDate: _selectedDate,
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 365)),
                  );
                  if (date != null) {
                    if (!context.mounted) return;
                    final time = await showTimePicker(
                      context: context,
                      initialTime: _selectedTime,
                    );
                    if (!context.mounted) return;
                    setState(() {
                      _selectedDate = date;
                      _selectedTime = time ?? _selectedTime;
                    });
                  }
                },
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _submitting
                    ? null
                    : () async {
                        if (!_formKey.currentState!.validate()) return;
                        setState(() => _submitting = true);
                        try {
                          final dt = DateTime(
                            _selectedDate.year,
                            _selectedDate.month,
                            _selectedDate.day,
                            _selectedTime.hour,
                            _selectedTime.minute,
                          );
                          await ref
                              .read(appointmentsRepositoryProvider)
                              .createAppointment(
                                serviceId: _selectedServiceId!,
                                customerName: _customerName.trim(),
                                normalizedPhone: _phone.trim().isEmpty
                                    ? null
                                    : _phone.trim(),
                                startAt: dt.toUtc().toIso8601String(),
                              );
                          ref.invalidate(appointmentsProvider);
                          if (context.mounted) Navigator.of(context).pop();
                        } finally {
                          if (mounted) setState(() => _submitting = false);
                        }
                      },
                child: _submitting
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Create Appointment'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
