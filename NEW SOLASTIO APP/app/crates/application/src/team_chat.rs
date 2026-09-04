use mongodb::bson::oid::ObjectId;
use serde::Deserialize;
use solastio_auth::rbac::has_permission;
use solastio_database::models::{ConversationMessageRecord, ConversationRecord};
use solastio_database::repositories::ChatRepository;
use solastio_shared::error::AppError;

use crate::auth::RequestContext;

#[derive(Clone)]
pub struct TeamChatService {
    chat: ChatRepository,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: String,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub body: String,
}

#[derive(Debug, Deserialize)]
pub struct ReceiptRequest {
    #[serde(default)]
    pub message_ids: Vec<String>,
    #[serde(default)]
    pub status: String,
}

impl TeamChatService {
    pub fn new(chat: ChatRepository) -> Self {
        Self { chat }
    }

    pub async fn conversations(
        &self,
        context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let branch_ids = self.branch_scope(context);
        let team = self
            .chat
            .ensure_team_conversation(&context.salon_id, &context.branch_id)
            .await?;
        let mut conversations = self
            .chat
            .visible_conversations(&context.salon_id, &branch_ids, &context.user_id)
            .await?;
        if !conversations.iter().any(|c| c.id == team.id) {
            conversations.push(team);
        }
        let items = Vec::new();
        let mut items = items;
        for conv in conversations {
            let (count, unread) = self
                .chat
                .count_messages(&context.salon_id, conv.id, &context.user_id)
                .await?;
            items.push(conversation_json(&conv, count, unread));
        }
        Ok(serde_json::json!({ "items": items }))
    }

    pub async fn messages(
        &self,
        context: &RequestContext,
        conversation_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let id = parse_conversation_id(conversation_id)?;
        let conversation = self.assert_visible(context, id).await?;
        self.chat
            .update_delivered(&context.salon_id, id, &context.user_id)
            .await?;
        let messages = self.chat.messages(&context.salon_id, id).await?;
        let items: Vec<_> = messages.into_iter().map(message_json).collect();
        Ok(
            serde_json::json!({ "items": items, "metadata": { "branchId": conversation.branch_id } }),
        )
    }

    pub async fn send_message(
        &self,
        context: &RequestContext,
        conversation_id: &str,
        request: SendMessageRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["write:appointments"])?;
        let body = request.body.trim().to_string();
        if body.is_empty() {
            return Err(AppError::Validation("body cannot be empty.".to_string()));
        }
        if body.chars().count() > 4000 {
            return Err(AppError::Validation(
                "body must be at most 4000 characters.".to_string(),
            ));
        }
        let id = parse_conversation_id(conversation_id)?;
        let conversation = self.assert_visible(context, id).await?;
        let message = ConversationMessageRecord {
            id: ObjectId::new(),
            salon_id: context.salon_id.clone(),
            conversation_id: id,
            message_type: conversation.conversation_type,
            sender_user_id: context.user_id.clone(),
            sender_name: String::new(),
            body,
            delivered_count: 0,
            read_count: 0,
        };
        let created = self.chat.insert_message(message, id).await?;
        Ok(message_json(created))
    }

    pub async fn update_receipts(
        &self,
        context: &RequestContext,
        conversation_id: &str,
        request: ReceiptRequest,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        let id = parse_conversation_id(conversation_id)?;
        self.assert_visible(context, id).await?;
        let ids: Vec<ObjectId> = request
            .message_ids
            .iter()
            .filter_map(|mid| ObjectId::parse_str(mid).ok())
            .take(200)
            .collect();
        let status = if request.status == "read" {
            "read"
        } else {
            "delivered"
        };
        let count = self
            .chat
            .increment_receipts(&context.salon_id, id, &ids, status)
            .await?;
        Ok(serde_json::json!({ "updated": count }))
    }

    pub async fn search(
        &self,
        context: &RequestContext,
        query: SearchQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        search_impl(self, context, &query.q, None).await
    }

    pub async fn search_in_conversation(
        &self,
        context: &RequestContext,
        conversation_id: &str,
        query: SearchQuery,
    ) -> Result<serde_json::Value, AppError> {
        require_any(context, &["read:appointments", "read:staff", "write:staff"])?;
        search_impl(self, context, &query.q, Some(conversation_id)).await
    }

    pub async fn private_owner(
        &self,
        _context: &RequestContext,
    ) -> Result<serde_json::Value, AppError> {
        Ok(serde_json::json!({ "created": false }))
    }

    async fn assert_visible(
        &self,
        context: &RequestContext,
        conversation_id: ObjectId,
    ) -> Result<ConversationRecord, AppError> {
        let conversation = self
            .chat
            .conversation(&context.salon_id, conversation_id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound("Conversation was not found in your workspace.".to_string())
            })?;
        let visible = conversation.conversation_type == "team"
            || conversation.participant_user_ids.contains(&context.user_id);
        if !visible {
            return Err(AppError::NotFound(
                "Conversation was not found in your workspace.".to_string(),
            ));
        }
        Ok(conversation)
    }

    fn branch_scope(&self, context: &RequestContext) -> Vec<String> {
        if context.branch_ids.is_empty() {
            vec![context.branch_id.clone()]
        } else {
            context.branch_ids.clone()
        }
    }
}

async fn search_impl(
    service: &TeamChatService,
    context: &RequestContext,
    q: &str,
    conversation_id: Option<&str>,
) -> Result<serde_json::Value, AppError> {
    let term = q.trim().to_string();
    if term.is_empty() {
        return Ok(serde_json::json!({ "items": [], "total": 0 }));
    }
    let branch_ids = service.branch_scope(context);
    let conversations = service
        .chat
        .visible_conversations(&context.salon_id, &branch_ids, &context.user_id)
        .await?;
    let ids: Vec<ObjectId> = if let Some(conversation_id) = conversation_id {
        let id = parse_conversation_id(conversation_id)?;
        service.assert_visible(context, id).await?;
        vec![id]
    } else {
        conversations.iter().map(|c| c.id).collect()
    };
    let messages = service
        .chat
        .search_messages(&context.salon_id, &ids, &term)
        .await?;
    let items: Vec<_> = messages.into_iter().map(message_json).collect();
    Ok(serde_json::json!({ "items": items, "total": items.len() }))
}

fn parse_conversation_id(value: &str) -> Result<ObjectId, AppError> {
    ObjectId::parse_str(value)
        .map_err(|_| AppError::Validation("A valid conversation id is required.".to_string()))
}

fn conversation_json(
    conversation: &ConversationRecord,
    count: u64,
    unread: u64,
) -> serde_json::Value {
    serde_json::json!({ "id": conversation.id.to_hex(), "type": conversation.conversation_type, "title": conversation.title, "branchId": conversation.branch_id, "participantUserIds": if conversation.participant_user_ids.is_empty() { None } else { Some(conversation.participant_user_ids.clone()) }, "messageCount": count, "unreadCount": unread, "lastMessageAt": conversation.last_message_at.and_then(|d| d.try_to_rfc3339_string().ok()) })
}

fn message_json(message: ConversationMessageRecord) -> serde_json::Value {
    serde_json::json!({ "id": message.id.to_hex(), "conversationId": message.conversation_id.to_hex(), "type": message.message_type, "senderUserId": message.sender_user_id, "senderName": message.sender_name, "body": message.body, "receipt": { "deliveredCount": message.delivered_count, "readCount": message.read_count } })
}

fn require_any(context: &RequestContext, permissions: &[&str]) -> Result<(), AppError> {
    if permissions
        .iter()
        .any(|permission| has_permission(&context.permissions, permission))
    {
        Ok(())
    } else {
        Err(AppError::Authorization)
    }
}
