import '../../../../core/network/api_client.dart';
import '../models/appointment_dto.dart';

class AppointmentsRepository {
  final ApiClient _api;
  AppointmentsRepository({required ApiClient api}) : _api = api;

  Future<List<AppointmentDto>> fetchAppointments({int? limit}) {
    final query = <String, String>{};
    if (limit != null) query['limit'] = limit.toString();
    return _api.get<List<AppointmentDto>>(
      '/api/v1/appointments',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => AppointmentDto.fromJson(e)).toList();
      },
    );
  }

  Future<AppointmentDto?> fetchAppointment(String id) async {
    final appointments = await fetchAppointments(limit: 100);
    for (final appointment in appointments) {
      if (appointment.id == id) return appointment;
    }
    return null;
  }

  Future<AppointmentDto> createAppointment({
    required String serviceId,
    required String customerName,
    required String startAt,
    String? branchId,
    String? staffId,
    String? normalizedPhone,
    String source = 'staff-app',
  }) {
    final body = <String, Object?>{
      'serviceId': serviceId,
      'customerName': customerName,
      'startAt': startAt,
      'source': source,
    };
    if (branchId != null) body['branchId'] = branchId;
    if (staffId != null) body['staffId'] = staffId;
    if (normalizedPhone != null) body['normalizedPhone'] = normalizedPhone;
    return _api.post<AppointmentDto>(
      '/api/v1/appointments',
      body: body,
      fromData: AppointmentDto.fromJson,
    );
  }

  Future<AppointmentDto> updateStatus({
    required String id,
    required String status,
    required int version,
  }) {
    return _api.patch<AppointmentDto>(
      '/api/v1/appointments/$id/status',
      body: {'status': status, 'version': version},
      fromData: AppointmentDto.fromJson,
    );
  }
}
