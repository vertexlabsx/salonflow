import '../../../../core/network/api_client.dart';
import '../models/payslip_dto.dart';

class PayrollRepository {
  final ApiClient _api;
  PayrollRepository({required ApiClient api}) : _api = api;

  Future<List<PayslipDto>> fetchPayslips({int? limit, int? offset}) {
    return _api.get<List<PayslipDto>>(
      '/api/v1/staff-os/mobile/payroll',
      query: {
        if (limit != null) 'limit': limit.toString(),
        if (offset != null) 'offset': offset.toString(),
      },
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => PayslipDto.fromJson(e)).toList();
      },
    );
  }
}
