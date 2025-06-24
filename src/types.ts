import { Client, ServerConfigData, TurnCredential } from './shared-types';

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

export interface IceServerConfig {
  urls: string;
  defaultUsername?: string;
  defaultPassword?: string;
  coturnStaticAuthSecret?: string;
  credentialExpiry?: number;
  credentialsRenewalWindow?: number;
}

export interface TurnConfig {
  forceRelayOnly: boolean;
  iceServers: IceServerConfig[];
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
  isAdmin: boolean;
}
export class RoomData {
  apiKeyId?: string = undefined;
  roomCode_?: string = undefined;
  serverSocketId?: string = undefined;
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
    volumeFalloffFactor: 0.5,
    volumeMaxDistance: 2000,
    occlusionNear: 300,
    occlusionFar: 25,
    occlusionEndDist: 2000,
    occlusionFalloffFactor: 3,
    alwaysHearVisiblePlayers: true,
    deadVoiceFilterFrequency: 750,
    spectatorsCanTalk: false,
  };

  constructor(roomCode: string, maxPlayers?: number) {
    this.clients = new Map<string, Client>();
    this.roomCode_ = roomCode;
    this.maxPlayers_ = maxPlayers;
    this.lastUpdateFromServer = Date.now() / 1000;
  }
}

export enum CsTeam {
  None = 0,
  Spectator = 1,
  Terrorist = 2,
  CounterTerrorist = 3,
}

export interface PlayerPositionApiData {
  steamId?: string;
  name?: string;
  isAdmin?: boolean;
  originX?: number;
  originY?: number;
  originZ?: number;
  lookAtX?: number;
  lookAtY?: number;
  lookAtZ?: number;
  team?: CsTeam;
  isAlive?: boolean;
  spectatingC4?: boolean;
}
