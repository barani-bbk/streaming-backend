import { Producer, Consumer, WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket } from "socket.io";
import { HlsService } from "../services/HlsService";
import { logger } from "../utils/Logger";

export class Peer {
  public readonly id: string;
  private readonly socket: Socket;

  public sendTransport: WebRtcTransport | null = null;
  public recvTransport: WebRtcTransport | null = null;
  public hlsService: HlsService | null = null;

  private readonly consumers = new Map<string, Consumer>();
  private readonly producers = new Map<string, Producer>();

  constructor(socket: Socket) {
    this.id = socket.id;
    this.socket = socket;
  }

  addProducer(producer: Producer) {
    this.producers.set(producer.id, producer);
    producer.on("transportclose", () => {
      logger.info(`Producer's transport closed: ${producer.id}`);
      producer.close();
      this.producers.delete(producer.id);
    });
  }

  getProducer(producerId: string): Producer | undefined {
    return this.producers.get(producerId);
  }

  getProducersByKind(kind: "audio" | "video"): Producer | undefined {
    return Array.from(this.producers.values()).find((p) => p.kind === kind);
  }

  getProducers(): Map<string, Producer> {
    return this.producers;
  }

  getConsumers(): Map<string, Consumer> {
    return this.consumers;
  }

  addConsumer(consumer: Consumer) {
    this.consumers.set(consumer.id, consumer);
    consumer.on("transportclose", () => {
      logger.info(`Consumer's transport closed: ${consumer.id}`);
      this.consumers.delete(consumer.id);
    });
  }

  getConsumer(consumerId: string): Consumer | undefined {
    return this.consumers.get(consumerId);
  }

  emit(event: string, data: any, callback?: (...args: any[]) => void) {
    if (callback) {
      this.socket.emit(event, data, callback);
    } else {
      this.socket.emit(event, data);
    }
  }

  close() {
    logger.info(`Closing peer ${this.id}`);

    // Close transports
    this.sendTransport?.close();
    this.recvTransport?.close();

    // Producers and consumers are closed via transportclose events
    this.producers.clear();
    this.consumers.clear();

    // Delegate HLS cleanup to the HlsService, which handles FFmpeg and ports
    this.hlsService?.cleanup();
    this.hlsService = null;
  }
}
