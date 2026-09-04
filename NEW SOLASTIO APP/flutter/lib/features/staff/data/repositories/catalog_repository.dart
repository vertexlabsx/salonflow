import '../../../../core/network/api_client.dart';
import '../models/service_dto.dart';
import '../models/client_dto.dart';

class CatalogRepository {
  final ApiClient _api;
  CatalogRepository({required ApiClient api}) : _api = api;

  Future<List<ServiceDto>> fetchServices({String? branchId}) {
    final query = <String, String>{};
    if (branchId != null) query['branchId'] = branchId;
    return _api.get<List<ServiceDto>>(
      '/api/v1/catalog/services',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => ServiceDto.fromJson(e)).toList();
      },
    );
  }

  Future<List<ClientDto>> searchClients({String? q}) {
    final query = <String, String>{};
    if (q != null) query['q'] = q;
    return _api.get<List<ClientDto>>(
      '/api/v1/catalog/customers',
      query: query,
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => ClientDto.fromJson(e)).toList();
      },
    );
  }

  Future<ClientDto> createClient({
    required String branchId,
    required String name,
    required String phone,
  }) {
    return _api.post<ClientDto>(
      '/api/v1/catalog/customers',
      body: {'branchId': branchId, 'name': name, 'normalizedPhone': phone},
      fromData: ClientDto.fromJson,
    );
  }
}
