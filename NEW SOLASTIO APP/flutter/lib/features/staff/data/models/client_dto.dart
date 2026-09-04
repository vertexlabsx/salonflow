import '../../../../core/utils/json.dart';

class ClientDto {
  const ClientDto({
    required this.id,
    required this.name,
    this.phone,
    this.email,
    this.gender,
    this.birthday,
    this.tags = const [],
    this.notes,
    this.address,
  });
  final String id;
  final String name;
  final String? phone;
  final String? email;
  final String? gender;
  final String? birthday;
  final List<String> tags;
  final String? notes;
  final String? address;

  factory ClientDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ClientDto(
      id: Json.string(map['id']) ?? '',
      name: Json.string(map['name']) ?? '',
      phone: Json.string(map['phone']),
      email: Json.string(map['email']),
      gender: Json.string(map['gender']),
      birthday: Json.string(map['birthday']),
      tags: Json.stringList(map['tags']),
      notes: Json.string(map['notes']),
      address: Json.string(map['address']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'phone': phone,
    'email': email,
    'gender': gender,
    'birthday': birthday,
    'tags': tags,
    'notes': notes,
    'address': address,
  };
}
