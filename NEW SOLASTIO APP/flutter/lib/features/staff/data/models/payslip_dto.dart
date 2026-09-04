import '../../../../core/utils/json.dart';

class PayslipDto {
  const PayslipDto({
    required this.id,
    required this.staffId,
    required this.periodStart,
    required this.periodEnd,
    required this.status,
    required this.grossPaise,
    required this.deductionsPaise,
    required this.netPaise,
    required this.version,
  });
  final String id;
  final String staffId;
  final String periodStart;
  final String periodEnd;
  final String status;
  final int grossPaise;
  final int deductionsPaise;
  final int netPaise;
  final int version;

  factory PayslipDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return PayslipDto(
      id: Json.string(map['id']) ?? '',
      staffId: Json.string(map['staffId']) ?? '',
      periodStart: Json.string(map['periodStart']) ?? '',
      periodEnd: Json.string(map['periodEnd']) ?? '',
      status: Json.string(map['status']) ?? '',
      grossPaise: Json.intNum(map['grossPaise']) ?? 0,
      deductionsPaise: Json.intNum(map['deductionsPaise']) ?? 0,
      netPaise: Json.intNum(map['netPaise']) ?? 0,
      version: Json.intNum(map['version']) ?? 0,
    );
  }

  String get netFormatted => '₹${(netPaise / 100).toStringAsFixed(0)}';
  String get grossFormatted => '₹${(grossPaise / 100).toStringAsFixed(0)}';
  String get deductionsFormatted =>
      '₹${(deductionsPaise / 100).toStringAsFixed(0)}';

  Map<String, Object?> toJson() => {
    'id': id,
    'staffId': staffId,
    'periodStart': periodStart,
    'periodEnd': periodEnd,
    'status': status,
    'grossPaise': grossPaise,
    'deductionsPaise': deductionsPaise,
    'netPaise': netPaise,
    'version': version,
  };
}
