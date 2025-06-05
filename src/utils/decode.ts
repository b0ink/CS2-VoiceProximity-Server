import { decode } from '@msgpack/msgpack';
import { PlayerPositionApiData } from '../types';

export function decodePlayerData(data: Buffer<ArrayBufferLike>): PlayerPositionApiData[] {
  const decoded = decode(new Uint8Array(data));
  const players = decoded as Array<
    [
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
    ]
  >;

  const localPlayerData: PlayerPositionApiData[] = [];

  for (const player of players) {
    const [steamId, name, isAdmin, ox, oy, oz, lx, ly, lz, team, isAlive, spectatingC4] = player;

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
    };
    localPlayerData.push(playerData);
  }

  return localPlayerData;
}
