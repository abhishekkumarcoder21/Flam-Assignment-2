/**
 * rooms.ts - Room and user management
 * 
 * RESPONSIBILITY: Manages connected users per room
 * - User tracking with metadata (name, color, cursor)
 * - Join/leave operations
 * - Cursor position updates
 * 
 * WHY SEPARATE FROM drawingState:
 * - User management is orthogonal to drawing logic
 * - Can scale rooms independently (e.g., room limits)
 * - Clear separation of concerns for testing
 */

export type User = {
    id: string;
    socketId: string;
    name: string;
    color: string;
    cursor: { x: number; y: number } | null;
    joinedAt: number;
};

// Predefined colors for user assignment
const USER_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
    '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1'
];

/**
 * Room class manages users in a single drawing room.
 */
export class Room {
    readonly id: string;
    private users: Map<string, User> = new Map();
    private colorIndex = 0;

    constructor(id: string) {
        this.id = id;
    }

    /**
     * Add a new user to the room.
     * Assigns a unique color from the palette.
     */
    addUser(socketId: string, userName: string): User {
        // Generate unique user ID from socket
        const userId = `user_${socketId.substring(0, 8)}`;

        // Assign color (cycle through palette)
        const color = USER_COLORS[this.colorIndex % USER_COLORS.length];
        this.colorIndex++;

        const user: User = {
            id: userId,
            socketId,
            name: userName || `User ${this.users.size + 1}`,
            color,
            cursor: null,
            joinedAt: Date.now()
        };

        this.users.set(socketId, user);
        return user;
    }

    /**
     * Remove a user from the room.
     */
    removeUser(socketId: string): User | null {
        const user = this.users.get(socketId);
        if (user) {
            this.users.delete(socketId);
        }
        return user || null;
    }

    /**
     * Update a user's cursor position.
     * Called frequently during drawing - keep it minimal.
     */
    updateCursor(socketId: string, x: number, y: number): void {
        const user = this.users.get(socketId);
        if (user) {
            user.cursor = { x, y };
        }
    }

    /**
     * Get user by socket ID.
     */
    getUser(socketId: string): User | undefined {
        return this.users.get(socketId);
    }

    /**
     * Get all users in the room.
     */
    getAllUsers(): User[] {
        return Array.from(this.users.values());
    }

    /**
     * Get count of users.
     */
    get userCount(): number {
        return this.users.size;
    }

    /**
     * Check if room is empty.
     */
    isEmpty(): boolean {
        return this.users.size === 0;
    }
}

/**
 * RoomManager handles multiple rooms.
 * For this implementation, we use a single default room.
 */
export class RoomManager {
    private rooms: Map<string, Room> = new Map();
    private static DEFAULT_ROOM = 'main';

    /**
     * Get or create a room.
     */
    getOrCreateRoom(roomId: string = RoomManager.DEFAULT_ROOM): Room {
        let room = this.rooms.get(roomId);
        if (!room) {
            room = new Room(roomId);
            this.rooms.set(roomId, room);
            console.log(`[RoomManager] Created room: ${roomId}`);
        }
        return room;
    }

    /**
     * Get a room by ID.
     */
    getRoom(roomId: string): Room | undefined {
        return this.rooms.get(roomId);
    }

    /**
     * Remove an empty room.
     */
    removeRoomIfEmpty(roomId: string): boolean {
        const room = this.rooms.get(roomId);
        if (room && room.isEmpty()) {
            this.rooms.delete(roomId);
            console.log(`[RoomManager] Removed empty room: ${roomId}`);
            return true;
        }
        return false;
    }

    /**
     * Get list of all active rooms.
     */
    getAllRooms(): Room[] {
        return Array.from(this.rooms.values());
    }
}
