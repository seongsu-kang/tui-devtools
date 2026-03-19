/**
 * session-manager.ts — Manages multiple PTY sessions
 */

import { PtySession, type PtySessionOptions, type PtySessionInfo } from './pty-session.js';

export class SessionManager {
  private sessions = new Map<string, PtySession>();

  create(id: string, options: PtySessionOptions): PtySessionInfo {
    // Kill existing session with same ID
    if (this.sessions.has(id)) {
      this.sessions.get(id)!.dispose();
    }

    const session = new PtySession(id, options);
    this.sessions.set(id, session);
    return session.info;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  list(): PtySessionInfo[] {
    return [...this.sessions.values()].map(s => s.info);
  }

  kill(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.dispose();
    this.sessions.delete(id);
    return true;
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }
}
