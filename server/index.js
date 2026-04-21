const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT || 8080);
const wss = new WebSocketServer({ port });

const rooms = new Map();
let nextPlayerId = 1;

function createRoom(roomId) {
    const room = {
        id: roomId,
        clients: new Map(),
        hostId: null,
    };
    rooms.set(roomId, room);
    return room;
}

function getRoom(roomId) {
    return rooms.get(roomId) || createRoom(roomId);
}

function safeSend(ws, message) {
    if (ws.readyState !== ws.OPEN) {
        return;
    }
    ws.send(JSON.stringify(message));
}

function broadcast(room, message, exceptPlayerId = null) {
    for (const [playerId, client] of room.clients) {
        if (exceptPlayerId && playerId === exceptPlayerId) {
            continue;
        }
        safeSend(client, message);
    }
}

function removeFromRoom(ws) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        return;
    }

    room.clients.delete(playerId);
    broadcast(room, { t: 'leave', playerId }, playerId);

    if (room.hostId === playerId) {
        const nextHost = room.clients.keys().next().value || null;
        room.hostId = nextHost;
        if (nextHost) {
            const hostClient = room.clients.get(nextHost);
            safeSend(hostClient, { t: 'role', isHost: true });
        }
    }

    ws.roomId = null;
    ws.playerId = null;

    if (room.clients.size === 0) {
        rooms.delete(room.id);
    }
}

function onJoin(ws, payload) {
    const roomId = String(payload.roomId || 'default');
    const room = getRoom(roomId);

    if (room.clients.size >= 2) {
        safeSend(ws, { t: 'error', code: 'room_full', message: 'Room is full (max 2).' });
        return;
    }

    removeFromRoom(ws);

    const playerId = String(nextPlayerId++);
    ws.roomId = roomId;
    ws.playerId = playerId;

    room.clients.set(playerId, ws);
    if (!room.hostId) {
        room.hostId = playerId;
    }

    safeSend(ws, {
        t: 'join',
        roomId,
        playerId,
        isHost: room.hostId === playerId,
    });

    broadcast(room, { t: 'peer_joined', playerId }, playerId);
    if (room.clients.size === 2) {
        broadcast(room, { t: 'match_ready' });
    }
}

function onState(ws, payload) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        return;
    }

    broadcast(
        room,
        {
            t: 'peer_state',
            playerId,
            state: payload.state || null,
        },
        playerId,
    );
}

function onEnemySnapshot(ws, payload) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room || room.hostId !== playerId) {
        return;
    }

    broadcast(
        room,
        {
            t: 'enemy_snapshot',
            enemies: Array.isArray(payload.enemies) ? payload.enemies : [],
        },
        playerId,
    );
}

function onSkillCast(ws, payload) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        return;
    }

    const cast = payload.cast && typeof payload.cast === 'object' ? payload.cast : null;

    broadcast(
        room,
        {
            t: 'peer_skill_cast',
            playerId,
            cast,
        },
        playerId,
    );
}

function onSkillDestroy(ws, payload) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        return;
    }

    const castId = String(payload.castId || '');
    if (!castId) {
        return;
    }

    broadcast(
        room,
        {
            t: 'peer_skill_destroy',
            playerId,
            castId,
        },
        playerId,
    );
}

function onFoodDestroy(ws, payload) {
    const roomId = ws.roomId;
    const playerId = ws.playerId;
    if (!roomId || !playerId) {
        return;
    }

    const room = rooms.get(roomId);
    if (!room) {
        return;
    }

    const foodId = String(payload.foodId || '');
    if (!foodId) {
        return;
    }

    broadcast(
        room,
        {
            t: 'peer_food_destroy',
            playerId,
            foodId,
        },
        playerId,
    );
}

wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.playerId = null;

    ws.on('message', (rawData) => {
        let payload = null;
        try {
            payload = JSON.parse(rawData.toString());
        } catch (_error) {
            safeSend(ws, { t: 'error', code: 'bad_json', message: 'Invalid JSON payload.' });
            return;
        }

        if (!payload || typeof payload !== 'object') {
            return;
        }

        switch (payload.t) {
            case 'join':
                onJoin(ws, payload);
                break;
            case 'state':
                onState(ws, payload);
                break;
            case 'enemy_snapshot':
                onEnemySnapshot(ws, payload);
                break;
            case 'skill_cast':
                onSkillCast(ws, payload);
                break;
            case 'skill_destroy':
                onSkillDestroy(ws, payload);
                break;
            case 'food_destroy':
                onFoodDestroy(ws, payload);
                break;
            default:
                safeSend(ws, { t: 'error', code: 'unknown_event', message: 'Unknown event type.' });
                break;
        }
    });

    ws.on('close', () => {
        removeFromRoom(ws);
    });

    ws.on('error', () => {
        removeFromRoom(ws);
    });
});

console.log(`[server] WebSocket room server running on ws://127.0.0.1:${port}`);
