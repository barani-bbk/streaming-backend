import { Producer, Consumer, WebRtcTransport } from "mediasoup/node/lib/types";
import { Socket } from "socket.io";

export class Peer {
  private _socketId: string;
  private socket: Socket;
  private _sendTransport: WebRtcTransport | null;
  private _recvTransport: WebRtcTransport | null;
  private _consumers: Map<string, Consumer>;
  private _producers: Map<string, Producer>;

  constructor(socket: Socket) {
    this._socketId = socket.id;
    this.socket = socket;
    this._sendTransport = null;
    this._recvTransport = null;
    this._consumers = new Map();
    this._producers = new Map();
  }

  addProducer(producer: Producer) {
    this._producers.set(producer.id, producer);
  }

  addConsumer(consumer: Consumer) {
    this._consumers.set(consumer.id, consumer);
  }

  removeProducer(producerId: string) {
    this._producers.delete(producerId);
  }

  removeConsumer(consumerId: string) {
    this._consumers.delete(consumerId);
  }

  emit(event: string, data: any) {
    this.socket.emit(event, data);
  }

  get id(): string {
    return this._socketId;
  }

  get sendTransport(): WebRtcTransport | null {
    return this._sendTransport;
  }
  set sendTransport(transport: WebRtcTransport | null) {
    this._sendTransport = transport;
  }

  get recvTransport(): WebRtcTransport | null {
    return this._recvTransport;
  }

  set recvTransport(transport: WebRtcTransport | null) {
    this._recvTransport = transport;
  }

  get consumers(): Map<string, Consumer> {
    return this._consumers;
  }

  get producers(): Map<string, Producer> {
    return this._producers;
  }

  close() {
    this.sendTransport?.close();
    this.recvTransport?.close();

    this.producers.forEach((producer) => producer.close());
    this.producers.clear();

    this.consumers.forEach((consumer) => consumer.close());
    this.consumers.clear();
  }
}
