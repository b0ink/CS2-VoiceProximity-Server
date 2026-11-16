import { Socket } from 'socket.io';
import { decode } from '@msgpack/msgpack';
import { ClientToServerEvents, ServerToClientEvents } from '../shared-types';

export function createSocketListener(socket: Socket<ClientToServerEvents, ServerToClientEvents>) {
  // Preserve Socket.IO's event-specific argument types across the common error boundary.
  const listen: typeof socket.on = (event, listener) =>
    socket.on(
      event,
      guardSocketHandler(socket, listener as (...args: unknown[]) => unknown) as typeof listener,
    );
  return listen;
}

export function guardSocketHandler<Args extends unknown[]>(
  socket: Pick<Socket, 'id' | 'disconnect'>,
  handler: (...args: Args) => unknown,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await handler(...args);
    } catch {
      // Socket.IO does not forward rejected listeners to Express error middleware.
      console.error(`Socket handler failed; disconnecting ${socket.id}`);
      socket.disconnect(true);
    }
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

export function isNonEmptyString(value: unknown, maxLength = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function decodeSocketData(data: unknown): unknown {
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > 256 * 1024) {
    throw new Error('Invalid binary socket payload');
  }

  return decode(data, {
    maxArrayLength: 128,
    maxMapLength: 128,
    maxStrLength: 8192,
    maxBinLength: 256 * 1024,
    maxExtLength: 0,
  });
}

export function hasValidConfigValues(value: unknown): value is Record<string, number | boolean> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)),
    )
  );
}
