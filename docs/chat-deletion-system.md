# Chat Deletion System Documentation

## Overview

The chat deletion system allows users to delete messages and chat rooms with different levels of deletion:

1. **Delete for Me** - Message/room is hidden only for the user who deleted it
2. **Delete for Everyone** - Message is permanently deleted for all participants (only sender can do this)
3. **Room Deletion** - Entire conversation is hidden for the user with optional history clearing

## Features

### Message Deletion

#### Delete Message for Current User Only
```javascript
socket.emit('deleteMessage', {
    messageId: 'message_id_here',
    deleteForEveryone: false // Default
});
```

#### Delete Message for Everyone (Sender Only)
```javascript
socket.emit('deleteMessage', {
    messageId: 'message_id_here',
    deleteForEveryone: true // Only sender can do this
});
```

### Room/Conversation Deletion

#### Delete Room by Room ID
```javascript
socket.emit('deleteRoom', {
    roomId: 'room_id_here',
    clearHistory: true // Default - also delete all messages for user
});
```

#### Delete Room by Other User ID
```javascript
socket.emit('deleteRoom', {
    otherUserId: 'other_user_id_here',
    clearHistory: true
});
```

### Message Recovery

#### Get Deleted Messages
```javascript
socket.emit('getDeletedMessages', {
    roomId: 'room_id_here',
    pageNo: 1,
    size: 20
});
```

#### Restore Deleted Message
```javascript
socket.emit('restoreMessage', {
    messageId: 'message_id_here'
});
```

## Socket Events

### Outgoing Events (Client → Server)

| Event | Parameters | Description |
|-------|------------|-------------|
| `deleteMessage` | `{messageId, deleteForEveryone}` | Delete a specific message |
| `deleteRoom` | `{roomId?, otherUserId?, clearHistory}` | Delete entire conversation |
| `getDeletedMessages` | `{roomId, pageNo, size}` | Get user's deleted messages |
| `restoreMessage` | `{messageId}` | Restore a deleted message |

### Incoming Events (Server → Client)

| Event | Data | Description |
|-------|------|-------------|
| `messageDeletedForMe` | `{messageId, deletedBy, timestamp}` | Message deleted for current user only |
| `messageDeletedForEveryone` | `{messageId, deletedBy, timestamp}` | Message deleted for all users |
| `messageDeleted` | `{success, messageId, deleteForEveryone, timestamp}` | Confirmation of deletion |
| `roomDeleted` | `{success, roomId, clearHistory, timestamp}` | Room deletion confirmation |
| `deletedMessagesList` | `{roomId, total, pageNo, size, messages, hasMore}` | List of deleted messages |
| `messageRestored` | `{success, message, timestamp}` | Message restoration confirmation |
| `roomUpdated` | `{...roomData, unreadCount}` | Room info updated after deletion |

## Database Schema Changes

### ChatMessage Model

```javascript
// Enhanced deletion tracking
deleteBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: Date.now },
    deleteType: { 
        type: String, 
        enum: ['MESSAGE_DELETE', 'ROOM_DELETE'], 
        default: 'MESSAGE_DELETE' 
    }
}],

// Soft delete flag for complete message removal
isDeleted: { type: Boolean, default: false },
deletedAt: { type: Date }
```

### ChatRoom Model

```javascript
// Enhanced deletion tracking for rooms
deleteBy: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: Date.now },
    clearHistory: { type: Boolean, default: true }
}],

// Soft delete flag for complete room removal
isDeleted: { type: Boolean, default: false },
deletedAt: { type: Date }
```

## Model Methods

### ChatMessage Static Methods

- `ChatMessage.getVisibleMessages(query, userId)` - Get messages visible to user
- `ChatMessage.deleteForUser(messageId, userId, deleteType)` - Delete message for user
- `ChatMessage.permanentDelete(messageId)` - Permanently delete message

### ChatMessage Instance Methods

- `message.isDeletedForUser(userId)` - Check if deleted for user
- `message.getDeleteInfoForUser(userId)` - Get deletion info for user

### ChatRoom Static Methods

- `ChatRoom.getVisibleRooms(query, userId)` - Get rooms visible to user
- `ChatRoom.deleteForUser(roomId, userId, clearHistory)` - Delete room for user
- `ChatRoom.permanentDelete(roomId)` - Permanently delete room

### ChatRoom Instance Methods

- `room.isDeletedForUser(userId)` - Check if deleted for user
- `room.getDeleteInfoForUser(userId)` - Get deletion info for user

## Utility Functions

Use the utility functions from `utils/chatUtils.js` for consistent filtering:

```javascript
const {
    getVisibleMessagesFilter,
    getVisibleRoomsFilter,
    getUnreadCountForRoom,
    getTotalUnreadCount,
    getLatestVisibleMessage,
    isMessageDeletedForUser,
    isRoomDeletedForUser,
    getDeleteInfoForUser
} = require('../utils/chatUtils');
```

## Best Practices

1. **Always use filtering** - Use the utility functions to ensure proper filtering of deleted content
2. **Handle permissions** - Only message senders can delete for everyone
3. **Update unread counts** - Always recalculate unread counts after deletions
4. **Emit proper events** - Different events for different deletion types
5. **Consider performance** - Use indexes on deletion fields for large datasets

## Frontend Integration Examples

### React Hook for Message Deletion

```javascript
const useMessageDeletion = (socket) => {
    const deleteMessage = (messageId, deleteForEveryone = false) => {
        socket.emit('deleteMessage', { messageId, deleteForEveryone });
    };

    const deleteRoom = (roomId, clearHistory = true) => {
        socket.emit('deleteRoom', { roomId, clearHistory });
    };

    const restoreMessage = (messageId) => {
        socket.emit('restoreMessage', { messageId });
    };

    return { deleteMessage, deleteRoom, restoreMessage };
};
```

### Handling Deletion Events

```javascript
useEffect(() => {
    socket.on('messageDeletedForEveryone', (data) => {
        // Remove message from UI for all users
        setMessages(prev => prev.filter(msg => msg._id !== data.messageId));
    });

    socket.on('messageDeletedForMe', (data) => {
        // Remove message from UI for current user only
        setMessages(prev => prev.filter(msg => msg._id !== data.messageId));
    });

    socket.on('roomDeleted', (data) => {
        // Remove room from UI
        setRooms(prev => prev.filter(room => room._id !== data.roomId));
    });

    return () => {
        socket.off('messageDeletedForEveryone');
        socket.off('messageDeletedForMe');
        socket.off('roomDeleted');
    };
}, [socket]);
```

## Performance Considerations

1. **Indexes** - All deletion-related fields are indexed for fast queries
2. **Bulk Operations** - Room deletion uses bulk updates for efficiency
3. **Pagination** - All list operations support pagination
4. **Lazy Loading** - Deleted messages are only loaded when requested

## Security Notes

1. Only message senders can delete messages for everyone
2. Users can only delete messages/rooms for themselves
3. All deletion operations are logged with timestamps
4. Permanent deletions should be restricted to admin users 