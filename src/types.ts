import { Client, ServerConfigData } from './shared-types';

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
    volumeFalloffFactor: 3,
    volumeMaxDistance: 2500,
    occlusionNear: 350,
    occlusionFar: 25,
    occlusionEndDist: 2000,
    occlusionFalloffExponent: 3,
  };

  constructor(roomCode: string, maxPlayers?: number) {
    this.clients = new Map<string, Client>();
    this.roomCode_ = roomCode;
    this.maxPlayers_ = maxPlayers;
    this.lastUpdateFromServer = Date.now() / 1000;
  }
}
