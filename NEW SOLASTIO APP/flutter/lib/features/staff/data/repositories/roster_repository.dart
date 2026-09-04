import '../../../../core/network/api_client.dart';
import '../models/schedule_dto.dart';

class RosterRepository {
  final ApiClient _api;
  RosterRepository({required ApiClient api}) : _api = api;

  Future<List<ScheduleDto>> fetchSchedules({String? from, String? to}) {
    final query = <String, String>{};
    if (from != null) query['from'] = from;
    if (to != null) query['to'] = to;
    return _api.get<List<ScheduleDto>>(
      '/api/v1/staff-self/calendar',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => ScheduleDto.fromJson(e)).toList();
      },
    );
  }

  Future<void> updateSchedule({
    required String scheduleId,
    String? status,
    int? version,
  }) {
    final body = <String, Object?>{};
    if (status != null) body['status'] = status;
    if (version != null) body['version'] = version;
    return _api.patch<void>(
      '/api/v1/staff-self/calendar/$scheduleId',
      body: body,
      fromData: (_) {},
    );
  }
}
