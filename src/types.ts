import Peer from 'simple-peer';
export interface SteamOpenIDParams {
  ns?: string;
  mode?: string;
  op_endpoint?: string;
  claimed_id?: string;
  identity?: string;
  return_to?: string;
  response_nonce?: string;
  assoc_handle?: string;
  signed?: string;
  sig?: string;
}

export interface Client {
  steamId: string;
  clientId: string;
  isMuted: boolean;
}

export interface JwtAuthPayload {
  steamId?: string;
  exp?: number;
  iat?: number;
  aud?: string;
}

export interface TurnCredential {
  username: string;
  password: string;
}

export interface SteamIdTurnCredentialMap {
  [steamId64: string]: TurnCredential;
}

export class JoinedPlayers {
  socketId: string | null = null;
  steamId: string | null = null;
  lastTimeOnServer: number = Date.now() / 1000;
}

export interface ServerPlayer {
  Name: string;
  SteamId: string;
}
export class RoomData {
  roomCode_?: string = undefined;
  maxPlayers_?: number = 10;
  joinedPlayers: JoinedPlayers[] = []; // active peer connections
  playersOnServer: ServerPlayer[] = []; // players actually on the cs2 server'
  lastUpdateFromServer: number;
  mapName?: string;
  clients: Map<string, Client>;
  serverConfig: ServerConfigData = {
    deadPlayerMuteDelay: 1000,
    allowDeadTeamVoice: true,
    allowSpectatorC4Voice: true,
    rolloffFactor: 1,
    refDistance: 39,
  };

  constructor(roomCode: string, maxPlayers?: number) {
    this.clients = new Map<string, Client>();
    this.roomCode_ = roomCode;
    this.maxPlayers_ = maxPlayers;
    this.lastUpdateFromServer = Date.now() / 1000;
  }
}

export interface JoinRoomData {
  token: string;
  roomCode: string;
  steamId: string;
  clientId: string;
  isHost: boolean;
  isMuted: boolean;
}

export interface JoinRoomResponse {
  success: boolean;
  message: string;
  mapName?: string;
  joinedClients?: { [key: string]: Client };
  serverConfig?: ServerConfigData;
}

export type JoinRoomCallback = (response: JoinRoomResponse) => void;

export interface PlayerData {
  steamId: string;
  name: string;
  origin: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  team: number;
  isAlive: boolean;
}

export interface Signal {
  data: Peer.SignalData;
  to: string;
}

export enum SocketApiErrorType {
  AuthExpired,
  InvalidApiKey,
}
export interface SocketApiError {
  code: SocketApiErrorType;
  message: string;
}

export interface ServerConfigData {
  deadPlayerMuteDelay?: number; // seconds before players are muted after dying
  allowDeadTeamVoice?: boolean; // can dead teammates communicate to each other
  allowSpectatorC4Voice?: boolean; // can dead players speak when spectating C4
  rolloffFactor?: number; // How quickly player voice volumes are reduced as you move away from them
  refDistance?: number; // The distance at which the volume reduction starts taking effect
  occlusionNear?: number; // The maximum occlusion level for players fully behind a wall at the closest distance (0 is fully occluded)
  occlusionFar?: number; // The maximum occlusion when player's distance reaches OcclusionEnd
  occlusionEndDist?: number; // Distance from player where it fully reaches OcclusionFar
}
