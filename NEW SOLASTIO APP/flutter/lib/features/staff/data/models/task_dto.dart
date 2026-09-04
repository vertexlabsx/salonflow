import '../../../../core/utils/json.dart';

class TaskDto {
  const TaskDto({
    required this.id,
    required this.title,
    this.description,
    required this.status,
    required this.version,
    this.dueDate,
    this.assignedTo,
  });
  final String id;
  final String title;
  final String? description;
  final String status;
  final int version;
  final String? dueDate;
  final String? assignedTo;

  factory TaskDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return TaskDto(
      id: Json.string(map['id']) ?? '',
      title: Json.string(map['title']) ?? '',
      description: Json.string(map['description']),
      status: Json.string(map['status']) ?? 'pending',
      version: Json.intNum(map['version']) ?? 0,
      dueDate: Json.string(map['dueDate']),
      assignedTo: Json.string(map['assignedTo']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'description': description,
    'status': status,
    'version': version,
    'dueDate': dueDate,
    'assignedTo': assignedTo,
  };
}
