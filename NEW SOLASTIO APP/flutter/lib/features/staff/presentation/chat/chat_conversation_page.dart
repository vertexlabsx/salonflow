import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/solastio_theme.dart';
import '../../../../core/widgets/loading_indicator.dart';
import '../../../../core/widgets/error_view.dart';
import '../providers/providers.dart';
import '../providers/actions_controller.dart';
import '../../data/models/conversation_dto.dart';
import '../../../auth/presentation/providers/auth_providers.dart';

class ChatConversationPage extends ConsumerStatefulWidget {
  const ChatConversationPage({
    super.key,
    required this.conversationId,
    required this.conversationName,
  });

  final String conversationId;
  final String conversationName;

  @override
  ConsumerState<ChatConversationPage> createState() =>
      _ChatConversationPageState();
}

class _ChatConversationPageState extends ConsumerState<ChatConversationPage> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    final messagesAsync = ref.watch(messagesProvider(widget.conversationId));
    final session = ref.watch(sessionProvider);
    final currentUserId = session.user?.id ?? '';

    return Scaffold(
      appBar: AppBar(title: Text(widget.conversationName)),
      body: Column(
        children: [
          Expanded(
            child: messagesAsync.when(
              loading: () =>
                  const LoadingIndicator(message: 'Loading messages...'),
              error: (e, _) => ErrorView(message: e.toString()),
              data: (items) {
                final messages = items as List<ChatMessageDto>;
                if (messages.isEmpty) {
                  return const Center(
                    child: Text(
                      'No messages yet',
                      style: TextStyle(color: Colors.grey),
                    ),
                  );
                }
                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding: const EdgeInsets.all(16),
                  itemCount: messages.length,
                  itemBuilder: (context, i) {
                    final msg = messages[messages.length - 1 - i];
                    final isMine = msg.senderId == currentUserId;
                    return _MessageBubble(message: msg, isMine: isMine);
                  },
                );
              },
            ),
          ),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: colors.surface,
              border: Border(top: BorderSide(color: colors.line)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 10,
                      ),
                    ),
                    maxLines: null,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: Icon(Icons.send, color: colors.accent),
                  onPressed: _send,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    _controller.clear();
    final actions = ref.read(actionsControllerProvider);
    actions.sendMessage(widget.conversationId, text).then((_) {
      ref.invalidate(messagesProvider(widget.conversationId));
    });
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message, required this.isMine});

  final ChatMessageDto message;
  final bool isMine;

  @override
  Widget build(BuildContext context) {
    final colors = SolastioTheme.of(context);
    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isMine ? colors.accent : colors.surfaceMuted,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!isMine)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  message.senderName,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: isMine ? Colors.white70 : colors.accent,
                  ),
                ),
              ),
            Text(
              message.body,
              style: TextStyle(
                color: isMine ? Colors.white : colors.ink,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              message.sentAt,
              style: TextStyle(
                fontSize: 10,
                color: isMine ? Colors.white54 : colors.muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
