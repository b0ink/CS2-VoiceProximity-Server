import { PlayerPositionApiData } from '../types';
import { decodeSocketData, isNonEmptyString, isRecord } from './socket';

type OcclusionFractionWire = Record<string, number> | Map<string, number>;
type PackedPlayerData = [
  string, // steamId
  string, // name
  boolean, // isAdmin
  number, // originX
  number, // originY
  number, // originZ
  number, // lookAtX
  number, // lookAtY
  number, // lookAtZ
  number, // team
  boolean, // isAlive
  boolean, // spectatingC4
  OcclusionFractionWire?, // occlusionFraction map keyed by steamId
];

export function decodePlayerData(data: Buffer<ArrayBufferLike>): PlayerPositionApiData[] {
  const decoded = decodeSocketData(data);
  if (!Array.isArray(decoded)) {
    throw new Error('Invalid player positions');
  }
  for (const player of decoded) {
    if (
      !Array.isArray(player) ||
      player.length < 12 ||
      player.length > 13 ||
      !isNonEmptyString(player[0], 32) ||
      typeof player[1] !== 'string' ||
      (player[2] !== null && typeof player[2] !== 'boolean') ||
      !player.slice(3, 10).every((value) => typeof value === 'number' && Number.isFinite(value)) ||
      typeof player[10] !== 'boolean' ||
      typeof player[11] !== 'boolean'
    ) {
      throw new Error('Invalid player position entry');
    }
  }
  const players = decoded as PackedPlayerData[];

  const localPlayerData: PlayerPositionApiData[] = [];

  for (const player of players) {
    const [steamId, name, isAdmin, ox, oy, oz, lx, ly, lz, team, isAlive, spectatingC4, occlusion] =
      player;

    // Cast to PlayerData interface
    const playerData: PlayerPositionApiData = {
      steamId,
      name,
      isAdmin: isAdmin ?? false,
      originX: ox,
      originY: oy,
      originZ: oz,
      lookAtX: lx,
      lookAtY: ly,
      lookAtZ: lz,
      team,
      isAlive,
      spectatingC4,
      occlusionFraction: decodeOcclusionFraction(occlusion),
    };
    localPlayerData.push(playerData);
  }

  return localPlayerData;
}

function decodeOcclusionFraction(value: OcclusionFractionWire | undefined): Record<string, number> {
  if (!value) {
    return {};
  }

  const output: Record<string, number> = {};
  if (!isRecord(value) && !(value instanceof Map)) {
    throw new Error('Invalid occlusion data');
  }
  if (value instanceof Map) {
    for (const [k, v] of value.entries()) {
      if (typeof k !== 'string' || typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error('Invalid occlusion entry');
      }
      output[k] = v;
    }
    return output;
  }

  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error('Invalid occlusion entry');
    }
    output[k] = v;
  }

  return output;
}
