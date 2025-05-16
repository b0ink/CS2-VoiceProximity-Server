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
}

export type JoinRoomCallback = (response: {
  success: boolean;
  message: string;
  mapName?: string;
  joinedClients?: Map<string, Client>;
}) => void;

export interface PlayerData {
  steamId: string;
  name: string;
  origin: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  team: number;
  isAlive: boolean;
}

export interface Signal {
  data: string;
  to: string;
}
