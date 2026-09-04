import '../../../../core/utils/json.dart';

class ServiceDto {
  const ServiceDto({
    required this.id,
    required this.name,
    this.description,
    required this.pricePaise,
    required this.durationMinutes,
  });
  final String id;
  final String name;
  final String? description;
  final int pricePaise;
  final int durationMinutes;

  factory ServiceDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ServiceDto(
      id: Json.string(map['id']) ?? '',
      name: Json.string(map['name']) ?? '',
      description: Json.string(map['description']),
      pricePaise: Json.intNum(map['pricePaise']) ?? 0,
      durationMinutes: Json.intNum(map['durationMinutes']) ?? 0,
    );
  }

  String get priceFormatted => '₹${(pricePaise / 100).toStringAsFixed(0)}';
  String get durationFormatted => '${durationMinutes}min';

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'pricePaise': pricePaise,
    'durationMinutes': durationMinutes,
  };
}
