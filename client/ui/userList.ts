/**
 * userList.ts - Connected users display
 * 
 * RESPONSIBILITY: Display connected users
 * - Show user list with color badges
 * - Indicate current user
 * - Connection status
 */

import { User } from '../canvas/stroke';

/**
 * UserList manages the connected users display.
 */
export class UserList {
    private container: HTMLElement;
    private users: User[] = [];
    private currentUserId: string | null = null;
    private connected: boolean = false;

    constructor(container: HTMLElement) {
        this.container = container;
        this.render();
    }

    /**
     * Set current user ID.
     */
    setCurrentUser(userId: string): void {
        this.currentUserId = userId;
        this.render();
    }

    /**
     * Set connection status.
     */
    setConnected(connected: boolean): void {
        this.connected = connected;
        this.render();
    }

    /**
     * Set full user list.
     */
    setUsers(users: User[]): void {
        this.users = users;
        this.render();
    }

    /**
     * Add a new user.
     */
    addUser(user: User): void {
        // Avoid duplicates
        if (!this.users.find(u => u.id === user.id)) {
            this.users.push(user);
            this.render();
        }
    }

    /**
     * Remove a user.
     */
    removeUser(userId: string): void {
        this.users = this.users.filter(u => u.id !== userId);
        this.render();
    }

    /**
     * Render the user list.
     */
    private render(): void {
        const statusClass = this.connected ? 'connected' : 'disconnected';
        const statusText = this.connected ? 'Connected' : 'Connecting...';

        this.container.innerHTML = `
      <div class="user-list-header">
        <span class="status-indicator ${statusClass}"></span>
        <span class="status-text">${statusText}</span>
        <span class="user-count">${this.users.length} user${this.users.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="user-list-items">
        ${this.users.map(user => this.renderUser(user)).join('')}
      </div>
    `;
    }

    /**
     * Render a single user item.
     */
    private renderUser(user: User): string {
        const isCurrentUser = user.id === this.currentUserId;

        return `
      <div class="user-item ${isCurrentUser ? 'current-user' : ''}">
        <span class="user-color" style="background-color: ${user.color}"></span>
        <span class="user-name">${user.name}${isCurrentUser ? ' (you)' : ''}</span>
      </div>
    `;
    }
}
