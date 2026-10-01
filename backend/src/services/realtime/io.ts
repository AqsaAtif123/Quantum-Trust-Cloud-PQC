import { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer): void {
  ioInstance = io;
}

/** Returns null if called before the server has finished bootstrapping (e.g. in isolated unit tests). */
export function getIO(): SocketIOServer | null {
  return ioInstance;
}
