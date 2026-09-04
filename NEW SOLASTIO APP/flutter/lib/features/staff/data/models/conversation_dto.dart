import '../../../../core/utils/json.dart';

class ConversationDto {
  const ConversationDto({
    required this.id,
    required this.name,
    this.lastMessage,
    this.lastMessageAt,
    this.unreadCount = 0,
    this.members = const [],
  });
  final String id;
  final String name;
  final String? lastMessage;
  final String? lastMessageAt;
  final int unreadCount;
  final List<String> members;

  factory ConversationDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ConversationDto(
      id: Json.string(map['id']) ?? '',
      name: Json.string(map['name']) ?? '',
      lastMessage: Json.string(map['lastMessage']),
      lastMessageAt: Json.string(map['lastMessageAt']),
      unreadCount: Json.intNum(map['unreadCount']) ?? 0,
      members: Json.stringList(map['members']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'lastMessage': lastMessage,
    'lastMessageAt': lastMessageAt,
    'unreadCount': unreadCount,
    'members': members,
  };
}

class ChatMessageDto {
  const ChatMessageDto({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.senderName,
    required this.body,
    required this.sentAt,
    this.readBy = const [],
  });
  final String id;
  final String conversationId;
  final String senderId;
  final String senderName;
  final String body;
  final String sentAt;
  final List<String> readBy;

  factory ChatMessageDto.fromJson(Object? json) {
    final map = Json.asMap(json);
    return ChatMessageDto(
      id: Json.string(map['id']) ?? '',
      conversationId: Json.string(map['conversationId']) ?? '',
      senderId: Json.string(map['senderId']) ?? '',
      senderName: Json.string(map['senderName']) ?? '',
      body: Json.string(map['body']) ?? '',
      sentAt: Json.string(map['sentAt']) ?? '',
      readBy: Json.stringList(map['readBy']),
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'conversationId': conversationId,
    'senderId': senderId,
    'senderName': senderName,
    'body': body,
    'sentAt': sentAt,
    'readBy': readBy,
  };
}
