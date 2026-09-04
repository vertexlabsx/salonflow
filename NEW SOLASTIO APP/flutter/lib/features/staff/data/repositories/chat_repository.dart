import '../../../../core/network/api_client.dart';
import '../models/conversation_dto.dart';

class ChatRepository {
  final ApiClient _api;
  ChatRepository({required ApiClient api}) : _api = api;

  Future<List<ConversationDto>> fetchConversations() {
    return _api.get<List<ConversationDto>>(
      '/api/v1/team-chat/conversations',
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => ConversationDto.fromJson(e)).toList();
      },
    );
  }

  Future<List<ChatMessageDto>> fetchMessages(String conversationId) {
    return _api.get<List<ChatMessageDto>>(
      '/api/v1/team-chat/conversations/$conversationId/messages',
      fromData: (data) {
        final list = data is List ? data : <Object?>[];
        return list.map((e) => ChatMessageDto.fromJson(e)).toList();
      },
    );
  }

  Future<ChatMessageDto> sendMessage({
    required String conversationId,
    required String body,
  }) {
    return _api.post<ChatMessageDto>(
      '/api/v1/team-chat/conversations/$conversationId/messages',
      body: {'body': body},
      fromData: ChatMessageDto.fromJson,
    );
  }

  Future<void> markRead({
    required String conversationId,
    required List<String> messageIds,
  }) {
    return _api.post<void>(
      '/api/v1/team-chat/conversations/$conversationId/receipts',
      body: {'messageIds': messageIds, 'status': 'read'},
      fromData: (_) {},
    );
  }
}
