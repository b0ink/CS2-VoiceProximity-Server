import { decode } from '@msgpack/msgpack';
import { PlayerPositionApiData } from '../types';

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
  const decoded = decode(new Uint8Array(data));
  const players = decoded as PackedPlayerData[];

  const localPlayerData: PlayerPositionApiData[] = [];

  for (const player of players) {
    const [steamId, name, isAdmin, ox, oy, oz, lx, ly, lz, team, isAlive, spectatingC4, occlusion] =
      player;

    // Cast to PlayerData interface
    const playerData: PlayerPositionApiData = {
      steamId,
      name,
      isAdmin,
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
  if (value instanceof Map) {
    for (const [k, v] of value.entries()) {
      if (typeof k === 'string' && typeof v === 'number') {
        output[k] = v;
      }
    }
    return output;
  }

  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'number') {
      output[k] = v;
    }
  }

  return output;
}
