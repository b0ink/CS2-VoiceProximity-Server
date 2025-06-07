import Peer from 'simple-peer';

export interface Client {
  steamId: string;
  isMuted: boolean;
}

export interface ServerToClientEvents {
  'current-map': (mapName: string) => void;
  'server-config': (data: Buffer<ArrayBufferLike>) => void;
  'player-positions': (data: Buffer<ArrayBufferLike>) => void;
  exception: (string: SocketApiError) => void;
  'player-on-server': (data: { roomCode: string }) => void;
  'user-left': (socketId: string, client: Client) => void;
  'user-joined': (socketId: string, client: Client) => void;
  signal: (data: { from: string; data: Peer.SignalData; client: Client }) => void;
  'microphone-state': (socketId: string, isMuted: boolean) => void;
  'muted-by-server-admin': () => void;
  'server-restart-warning': (data: { minutes: number }) => void;
  'door-rotation': (data: {
    absorigin: { x: number; y: number; z: number };
    rotation: number;
  }) => void;
}

export interface ClientToServerEvents {
  'server-config': (from: string, data: Buffer<ArrayBufferLike>) => void;
  exception: SocketApiError;
  'current-map': (from: string, mapName: string) => void;
  'player-positions': (from: string, data: Buffer<ArrayBufferLike>) => void;
  'join-room': (data: JoinRoomData, callback: JoinRoomCallback) => void;
  signal: (signal: Signal) => void;
  'microphone-state': (state: { isMuted: boolean }) => void;
  'update-config': (data: { config: ServerConfigData; clientToken: string }) => void;
  'mute-player': (data: { targetSteamId: string; clientToken: string }) => void;
  'door-rotation': (from: string, origin: string, rotation: number) => void;
}

export type JoinRoomCallback = (response: JoinRoomResponse) => void;

export interface Signal {
  data: Peer.SignalData;
  to: string;
}

export interface JoinRoomData {
  token: string;
  roomCode: string;
  steamId: string;
  isMuted: boolean;
}

export enum SocketApiErrorType {
  AuthExpired,
  InvalidApiKey,
  RoomShutdown,
  PlayerDisconnected,
  PluginOutdated,
  InvalidServerIp,
  ReusedApiKey,
}

export interface SocketApiError {
  code: SocketApiErrorType;
  message: string;
}

export interface JoinRoomResponse {
  success: boolean;
  message: string;
  mapName?: string;
  joinedClients?: { [key: string]: Client };
  serverConfig?: ServerConfigData;
}

export interface ServerConfigData {
  deadPlayerMuteDelay: number; // seconds before players are muted after dying
  allowDeadTeamVoice: boolean; // can dead teammates communicate to each other
  allowSpectatorC4Voice: boolean; // can dead players speak when spectating C4
  volumeFalloffFactor: number; // How quickly player voice volumes are reduced as you move away from them
  volumeMaxDistance: number; // The distance at which the volume reduction starts taking effect
  occlusionNear: number; // The maximum occlusion level for players fully behind a wall at the closest distance (0 is fully occluded)
  occlusionFar: number; // The maximum occlusion when player's distance reaches OcclusionEnd
  occlusionEndDist: number; // Distance from player where it fully reaches OcclusionFar
  occlusionFalloffFactor: number; // Controls how quickly occlusion drops off with distance (higher = steeper drop near end, lower = more gradual fade)
  alwaysHearVisiblePlayers: boolean; // Players are audible if they are within view, regardless of max distance settings
  deadVoiceFilterFrequency: number; // How "thin" or radio-like players sound when dead (0 disables the effect)
  spectatorsCanTalk: boolean; // Can Ts & CTs hear spectators?
}
