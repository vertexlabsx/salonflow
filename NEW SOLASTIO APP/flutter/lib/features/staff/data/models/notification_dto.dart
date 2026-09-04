import '../../../../core/utils/json.dart';

class NotificationDto {
  const NotificationDto({
    required this.id,
    required this.title,
    required this.body,
    required this.status,
    required this.createdAt,
    this.type,
    this.link,
  });
  final String id;
  final String title;
  final String body;
  final String status;
  final String createdAt;
  final String? type;
  final String? link;

  factory NotificationDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return NotificationDto(
      id: Json.string(map['id']) ?? '',
      title: Json.string(map['title']) ?? '',
      body: Json.string(map['body']) ?? '',
      status: Json.string(map['status']) ?? 'unread',
      createdAt: Json.string(map['createdAt']) ?? '',
      type: Json.string(map['type']),
      link: Json.string(map['link']),
    );
  }

  bool get isUnread => status == 'unread';

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'body': body,
    'status': status,
    'createdAt': createdAt,
    'type': type,
    'link': link,
  };
}
