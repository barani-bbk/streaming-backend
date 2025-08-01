import { Peer } from "../models/Peer";
import { logger } from "../utils/Logger";

export class PeerManager {
  private peers = new Map<string, Peer>();

  public add(peer: Peer): void {
    this.peers.set(peer.id, peer);
    logger.info(`Peer added: ${peer.id}. Total peers: ${this.peers.size}`);
  }

  public get(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  public remove(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.close();
      this.peers.delete(peerId);
      logger.info(`Peer removed: ${peerId}. Total peers: ${this.peers.size}`);
    }
  }

  public getOtherPeers(excludeId: string): Peer[] {
    return Array.from(this.peers.values()).filter((p) => p.id !== excludeId);
  }

  public getAllPeers(): Peer[] {
    return Array.from(this.peers.values());
  }
}
